import os
import asyncio
from agentscope.agent import Agent
from agentscope.message import UserMsg
from agentscope.model import OpenAIChatModel

async def main():
    model = OpenAIChatModel(
        model_name="gpt-4o-mini",
        api_key=os.environ.get("OPENAI_API_KEY", "dummy")
    )
    
    agent = Agent(name="TestAgent", system_prompt="You are a helpful assistant.", model=model)
    
    msg = UserMsg(name="User", content="Hello, say 'Test'!")
    
    print("Calling agent...")
    response = await agent.reply(msg)
    print("Response:", response.content)

if __name__ == "__main__":
    asyncio.run(main())
