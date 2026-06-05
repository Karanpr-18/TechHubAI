import inspect
from agentscope.model import OpenAIChatModel

# Let's inspect the _call_api method on OpenAIChatModel
try:
    print(inspect.getsource(OpenAIChatModel._call_api))
except Exception as e:
    print("Error getting _call_api:", e)
