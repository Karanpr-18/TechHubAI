import asyncio
from agentscope.agent import Agent
from agentscope.message import UserMsg
from agentscope.model import OpenAIChatModel

async def main():
    model = OpenAIChatModel(
        config_name="test",
        model_name="llama-3.3-70b-versatile",
        api_key="none",
        client_args={"base_url": "https://api.groq.com/openai/v1"}
    )
    # wait I need valid api key
