import sys
from agentscope.model import OpenAIChatModel
with open("openai_model_help.txt", "w") as f:
    sys.stdout = f
    help(OpenAIChatModel)
