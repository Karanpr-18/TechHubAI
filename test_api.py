import requests

url = "http://127.0.0.1:8000/api/debate/start"
payload = {
    "project_requirements": "I want to build a high performance trading bot",
    "provider": "groq",
    "model": "llama-3.3-70b-versatile"
}

response = requests.post(url, json=payload)
print(response.json())
