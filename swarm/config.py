"""
Configuration module for TechHubAI.
Handles BYOK (Bring Your Own Key) model configuration and environment loading.
"""

import os
from dataclasses import dataclass, field
from typing import Optional
from dotenv import load_dotenv
from agentscope.model import OpenAIChatModel, AnthropicChatModel
from agentscope.credential import OpenAICredential, AnthropicCredential
from agentscope.model._base import ChatModelBase

load_dotenv()


class MistralFormatterWrapper:
    """
    Wrapper for AgentScope's OpenAI formatter to strip the 'name' field
    from system, user, and assistant messages. This prevents 422 Unprocessable
    Entity errors from the Mistral API which strictly forbids extra fields.
    """
    def __init__(self, original_formatter):
        self.original_formatter = original_formatter

    async def format(self, msgs: list) -> list[dict]:
        formatted = await self.original_formatter.format(msgs)
        for msg in formatted:
            if "name" in msg and msg.get("role") in ["system", "user", "assistant"]:
                del msg["name"]
        return formatted

    def __getattr__(self, name):
        return getattr(self.original_formatter, name)


@dataclass
class LLMConfig:
    """Configuration for a single LLM provider."""
    provider: str
    model: str
    api_key: str
    temperature: float = 0.7
    max_tokens: int = 2048
    fallback_model: Optional[str] = None

    def get_agentscope_model(self) -> ChatModelBase:
        """Return an initialized AgentScope ChatModelBase instance."""
        if self.provider == "anthropic":
            cred = AnthropicCredential(api_key=self.api_key)
            return AnthropicChatModel(
                credential=cred,
                model=self.model,
                parameters=AnthropicChatModel.Parameters(
                    temperature=self.temperature,
                    max_tokens=self.max_tokens,
                )
            )
        
        # OpenAI, Groq, Mistral use OpenAI compatible endpoints
        base_url = None
        if self.provider == "groq":
            base_url = "https://api.groq.com/openai/v1"
        elif self.provider == "mistral":
            base_url = "https://api.mistral.ai/v1"
            
        cred = OpenAICredential(
            api_key=self.api_key,
            base_url=base_url
        )
        model_instance = OpenAIChatModel(
            credential=cred,
            model=self.model,
            parameters=OpenAIChatModel.Parameters(
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )
        )
        if self.provider == "mistral":
            model_instance.formatter = MistralFormatterWrapper(model_instance.formatter)
        return model_instance


@dataclass
class SwarmConfig:
    """Master configuration for TechHubAI."""

    # Primary LLM for debate agents
    primary_llm: LLMConfig = field(default_factory=lambda: LLMConfig(
        provider=os.getenv("PRIMARY_LLM_PROVIDER", "groq"),
        model=os.getenv("PRIMARY_LLM_MODEL", "llama-3.3-70b-versatile"),
        api_key=os.getenv(f"{os.getenv('PRIMARY_LLM_PROVIDER', 'groq').upper()}_API_KEY", ""),
    ))

    # Summarizer LLM for token optimization
    summarizer_llm: LLMConfig = field(default_factory=lambda: LLMConfig(
        provider=os.getenv("SUMMARIZER_LLM_PROVIDER", "groq"),
        model=os.getenv("SUMMARIZER_LLM_MODEL", "llama-3.3-70b-versatile"),
        api_key=os.getenv(f"{os.getenv('SUMMARIZER_LLM_PROVIDER', 'groq').upper()}_API_KEY", ""),
        temperature=0.3,
        max_tokens=1024,
    ))

    # Debate settings
    debate_rounds: int = 3
    max_searches_per_agent_per_round: int = 2
    max_crawl_pages_per_search: int = 1

    # API settings
    api_host: str = os.getenv("API_HOST", "0.0.0.0")
    api_port: int = int(os.getenv("API_PORT", "8000"))

    def get_api_key(self, provider: str) -> str:
        """Get the API key for a specific provider."""
        key_map = {
            "openai": os.getenv("OPENAI_API_KEY", ""),
            "anthropic": os.getenv("ANTHROPIC_API_KEY", ""),
            "groq": os.getenv("GROQ_API_KEY", ""),
            "mistral": os.getenv("MISTRAL_API_KEY", ""),
        }
        return key_map.get(provider, "")

    def validate(self) -> list[str]:
        """Validate configuration, return list of issues."""
        issues = []
        if not self.primary_llm.api_key:
            issues.append(
                f"Missing API key for primary LLM provider: {self.primary_llm.provider}. "
                f"Set {self.primary_llm.provider.upper()}_API_KEY in your .env file."
            )
        if not self.summarizer_llm.api_key:
            issues.append(
                f"Missing API key for summarizer LLM provider: {self.summarizer_llm.provider}. "
                f"Set {self.summarizer_llm.provider.upper()}_API_KEY in your .env file."
            )
        return issues
