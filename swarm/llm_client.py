"""
LLM Client Module
==================
Unified LLM interface supporting Groq, OpenAI, and Anthropic via BYOK.
Provides a single `call_llm()` function that routes to the correct provider.
"""

import json
import time
import asyncio
import os
from typing import Optional
from swarm.config import LLMConfig


class TokenRateLimiter:
    """
    Tracks token usage in a sliding 60-second window and enforces a maximum
    Tokens Per Minute (TPM) limit by sleeping when capacity is exceeded.
    """
    def __init__(self, max_tpm: int):
        self.max_tpm = max_tpm
        self.history = []  # List of tuples: (timestamp, token_count)
        self.lock = asyncio.Lock()

    async def wait_for_tokens(self, estimated_tokens: int):
        async with self.lock:
            while True:
                now = time.time()
                # Clean up entries older than 60 seconds
                self.history = [t for t in self.history if now - t[0] < 60]
                
                current_tpm = sum(t[1] for t in self.history)
                if not self.history or current_tpm + estimated_tokens <= self.max_tpm:
                    self.history.append((now, estimated_tokens))
                    return
                
                # Sleep until the oldest window item rolls off
                if self.history:
                    oldest_time = self.history[0][0]
                    wait_time = 60 - (now - oldest_time) + 0.1
                    wait_time = max(0.1, wait_time)
                else:
                    wait_time = 1.0
                
                await asyncio.sleep(wait_time)

    def record_usage(self, tokens: int):
        now = time.time()
        self.history.append((now, tokens))


# Initialize global limiter based on env configuration (default to 6000 TPM)
MAX_TPM = int(os.getenv("MAX_TPM", "6000"))
_limiter = TokenRateLimiter(max_tpm=MAX_TPM)

FALLBACK_MODELS = {
    "groq": ["openai/gpt-oss-120b", "qwen/qwen3-32b"],
    "openai": ["gpt-4o-mini", "gpt-3.5-turbo"],
    "anthropic": ["claude-3-5-haiku-latest", "claude-3-haiku-20240307"],
    "mistral": ["open-mixtral-8x22b", "mistral-small-latest"]
}

def _get_fallback_configs(config: LLMConfig) -> list[LLMConfig]:
    """Generates a list of fallback configs to try in order."""
    configs = []
    
    # Prioritize user-specified fallback model if set
    if config.fallback_model:
        configs.append(LLMConfig(
            provider=config.provider,
            model=config.fallback_model,
            api_key=config.api_key,
            temperature=config.temperature,
            max_tokens=config.max_tokens
        ))
        
    # 1. Try other models on the same provider
    provider = config.provider
    models = FALLBACK_MODELS.get(provider, [])
    for model in models:
        if model != config.model and model != config.fallback_model:
            configs.append(LLMConfig(
                provider=provider,
                model=model,
                api_key=config.api_key,
                temperature=config.temperature,
                max_tokens=config.max_tokens
            ))
            
    # 2. Try other providers if we have keys in the env
    other_providers = ["groq", "openai", "anthropic", "mistral"]
    for p in other_providers:
        if p != provider:
            key_var = f"{p.upper()}_API_KEY"
            env_key = os.getenv(key_var, "")
            if env_key:
                default_models = {
                    "groq": "llama-3.3-70b-versatile",
                    "openai": "gpt-4o-mini",
                    "anthropic": "claude-3-5-haiku-latest",
                    "mistral": "mistral-medium-latest"
                }
                configs.append(LLMConfig(
                    provider=p,
                    model=default_models[p],
                    api_key=env_key,
                    temperature=config.temperature,
                    max_tokens=config.max_tokens
                ))
    return configs


async def call_llm(
    config: LLMConfig,
    system_prompt: str,
    user_prompt: str,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> str:
    """
    Call an LLM with unified interface across providers.
    Enforces a strict global TPM rate limiter to prevent 429 errors.
    Automatically falls back to backup models/providers on failure.
    """
    configs_to_try = [config] + _get_fallback_configs(config)
    last_error = None
    
    for attempt_cfg in configs_to_try:
        try:
            estimated_tokens = (len(system_prompt) + len(user_prompt)) // 4
            await _limiter.wait_for_tokens(estimated_tokens)

            temp = temperature if temperature is not None else attempt_cfg.temperature
            tokens = max_tokens if max_tokens is not None else attempt_cfg.max_tokens

            if attempt_cfg.provider == "groq":
                response = await _call_groq(attempt_cfg, system_prompt, user_prompt, temp, tokens)
            elif attempt_cfg.provider == "openai":
                response = await _call_openai(attempt_cfg, system_prompt, user_prompt, temp, tokens)
            elif attempt_cfg.provider == "anthropic":
                response = await _call_anthropic(attempt_cfg, system_prompt, user_prompt, temp, tokens)
            elif attempt_cfg.provider == "mistral":
                response = await _call_mistral(attempt_cfg, system_prompt, user_prompt, temp, tokens)
            else:
                raise ValueError(f"Unsupported LLM provider: {attempt_cfg.provider}")

            _limiter.record_usage(len(response) // 4)
            return response
        except Exception as e:
            print(f"⚠️  LLM call failed for {attempt_cfg.provider}/{attempt_cfg.model}: {str(e)}")
            last_error = e
            await asyncio.sleep(0.5)
            
    raise last_error


async def call_llm_streaming(
    config: LLMConfig,
    system_prompt: str,
    user_prompt: str,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
):
    """
    Stream LLM responses. Yields chunks of text as they arrive.
    Enforces a strict global TPM rate limiter.
    Automatically falls back to backup models/providers if initialization fails.
    """
    configs_to_try = [config] + _get_fallback_configs(config)
    last_error = None
    
    for attempt_cfg in configs_to_try:
        try:
            estimated_tokens = (len(system_prompt) + len(user_prompt)) // 4
            await _limiter.wait_for_tokens(estimated_tokens)

            temp = temperature if temperature is not None else attempt_cfg.temperature
            tokens = max_tokens if max_tokens is not None else attempt_cfg.max_tokens

            response_len = 0
            if attempt_cfg.provider == "groq":
                async for chunk in _stream_groq(attempt_cfg, system_prompt, user_prompt, temp, tokens):
                    response_len += len(chunk)
                    yield chunk
            elif attempt_cfg.provider == "openai":
                async for chunk in _stream_openai(attempt_cfg, system_prompt, user_prompt, temp, tokens):
                    response_len += len(chunk)
                    yield chunk
            elif attempt_cfg.provider == "anthropic":
                async for chunk in _stream_anthropic(attempt_cfg, system_prompt, user_prompt, temp, tokens):
                    response_len += len(chunk)
                    yield chunk
            elif attempt_cfg.provider == "mistral":
                async for chunk in _stream_mistral(attempt_cfg, system_prompt, user_prompt, temp, tokens):
                    response_len += len(chunk)
                    yield chunk
            else:
                raise ValueError(f"Unsupported LLM provider: {attempt_cfg.provider}")

            _limiter.record_usage(response_len // 4)
            return
        except Exception as e:
            print(f"⚠️  LLM stream failed for {attempt_cfg.provider}/{attempt_cfg.model}: {str(e)}")
            last_error = e
            await asyncio.sleep(0.5)
            
    raise last_error


# ─── Groq ─────────────────────────────────────────────────────────────────────

async def _call_groq(config: LLMConfig, system: str, user: str, temp: float, tokens: int) -> str:
    from groq import AsyncGroq
    client = AsyncGroq(api_key=config.api_key)
    response = await client.chat.completions.create(
        model=config.model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temp,
        max_tokens=tokens,
    )
    return response.choices[0].message.content


async def _stream_groq(config: LLMConfig, system: str, user: str, temp: float, tokens: int):
    from groq import AsyncGroq
    client = AsyncGroq(api_key=config.api_key)
    stream = await client.chat.completions.create(
        model=config.model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temp,
        max_tokens=tokens,
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


# ─── OpenAI ───────────────────────────────────────────────────────────────────

async def _call_openai(config: LLMConfig, system: str, user: str, temp: float, tokens: int) -> str:
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=config.api_key)
    response = await client.chat.completions.create(
        model=config.model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temp,
        max_tokens=tokens,
    )
    return response.choices[0].message.content


async def _stream_openai(config: LLMConfig, system: str, user: str, temp: float, tokens: int):
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=config.api_key)
    stream = await client.chat.completions.create(
        model=config.model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temp,
        max_tokens=tokens,
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


# ─── Anthropic ────────────────────────────────────────────────────────────────

async def _call_anthropic(config: LLMConfig, system: str, user: str, temp: float, tokens: int) -> str:
    from anthropic import AsyncAnthropic
    client = AsyncAnthropic(api_key=config.api_key)
    response = await client.messages.create(
        model=config.model,
        system=system,
        messages=[
            {"role": "user", "content": user},
        ],
        temperature=temp,
        max_tokens=tokens,
    )
    return response.content[0].text


async def _stream_anthropic(config: LLMConfig, system: str, user: str, temp: float, tokens: int):
    from anthropic import AsyncAnthropic
    client = AsyncAnthropic(api_key=config.api_key)
    async with client.messages.stream(
        model=config.model,
        system=system,
        messages=[
            {"role": "user", "content": user},
        ],
        temperature=temp,
        max_tokens=tokens,
    ) as stream:
        async for text in stream.text_stream:
            yield text


# ─── Mistral ──────────────────────────────────────────────────────────────────

async def _call_mistral(config: LLMConfig, system: str, user: str, temp: float, tokens: int) -> str:
    from openai import AsyncOpenAI
    api_key = config.api_key or os.getenv("MISTRAL_API_KEY", "")
    client = AsyncOpenAI(api_key=api_key, base_url="https://api.mistral.ai/v1")
    response = await client.chat.completions.create(
        model=config.model or "mistral-large-latest",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temp,
        max_tokens=tokens,
    )
    return response.choices[0].message.content


async def _stream_mistral(config: LLMConfig, system: str, user: str, temp: float, tokens: int):
    from openai import AsyncOpenAI
    api_key = config.api_key or os.getenv("MISTRAL_API_KEY", "")
    client = AsyncOpenAI(api_key=api_key, base_url="https://api.mistral.ai/v1")
    stream = await client.chat.completions.create(
        model=config.model or "mistral-large-latest",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temp,
        max_tokens=tokens,
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
