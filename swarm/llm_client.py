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
    """
    estimated_tokens = (len(system_prompt) + len(user_prompt)) // 4
    await _limiter.wait_for_tokens(estimated_tokens)

    temp = temperature if temperature is not None else config.temperature
    tokens = max_tokens if max_tokens is not None else config.max_tokens

    if config.provider == "groq":
        response = await _call_groq(config, system_prompt, user_prompt, temp, tokens)
    elif config.provider == "openai":
        response = await _call_openai(config, system_prompt, user_prompt, temp, tokens)
    elif config.provider == "anthropic":
        response = await _call_anthropic(config, system_prompt, user_prompt, temp, tokens)
    else:
        raise ValueError(f"Unsupported LLM provider: {config.provider}")

    _limiter.record_usage(len(response) // 4)
    return response


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
    """
    estimated_tokens = (len(system_prompt) + len(user_prompt)) // 4
    await _limiter.wait_for_tokens(estimated_tokens)

    temp = temperature if temperature is not None else config.temperature
    tokens = max_tokens if max_tokens is not None else config.max_tokens

    response_len = 0
    if config.provider == "groq":
        async for chunk in _stream_groq(config, system_prompt, user_prompt, temp, tokens):
            response_len += len(chunk)
            yield chunk
    elif config.provider == "openai":
        async for chunk in _stream_openai(config, system_prompt, user_prompt, temp, tokens):
            response_len += len(chunk)
            yield chunk
    elif config.provider == "anthropic":
        async for chunk in _stream_anthropic(config, system_prompt, user_prompt, temp, tokens):
            response_len += len(chunk)
            yield chunk
    else:
        raise ValueError(f"Unsupported LLM provider: {config.provider}")

    _limiter.record_usage(response_len // 4)


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
