import os
import asyncio
from agentscope.agent import Agent
from agentscope.message import UserMsg
from agentscope.model import OpenAIChatModel
from agentscope.credential import OpenAICredential

async def main():
    cred = OpenAICredential(
        api_key=os.environ.get("GROQ_API_KEY", "dummy"),
        base_url="https://api.groq.com/openai/v1"
    )
    
    model = OpenAIChatModel(
        credential=cred,
        model="llama3-8b-8192",
    )
    
    agent = Agent(name="TestAgent", system_prompt="You are a helpful assistant.", model=model)
    msg = UserMsg(name="User", content="Hello!")
    
    response = await agent.reply(msg)
    print("Response:", response.content)

if __name__ == "__main__":
    asyncio.run(main())
