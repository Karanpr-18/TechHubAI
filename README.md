# 🤖 Agent Swarm - The Tech Stack Council

An open-source multi-agent system where **4 AI agents with completely different perspectives** debate and argue to find the perfect tech stack and architecture for your project.

## 🏛️ How It Works

1. **You describe your project** — Paste your requirements or upload a file
2. **4 Agents debate** — Each agent researches and argues from their unique angle:
   - 🏛️ **The Veteran** — Boring, proven, battle-tested tech
   - 🚀 **The Scaler** — Cloud-native, scalable, fast-to-ship
   - ⚡ **The Pioneer** — Maximum performance, bleeding-edge
   - 🧪 **The Mad Scientist** — Unheard, experimental, fresh tech
3. **The Judge synthesizes** — Creates 2-3 hybrid architectures with pros/cons
4. **You set your priorities** — Rate factors like cost, latency, scalability (1-10)
5. **Final Verdict** — The Judge optimizes the tech stack based on YOUR priorities

## 🛠️ Tech Stack (for this project)

### Backend
- **Python** with **AgentScope** for multi-agent orchestration
- **FastAPI** for the REST API + SSE streaming
- **DuckDuckGo + Crawl4AI** for real-time web research
- **Groq / OpenAI / Anthropic** via BYOK (Bring Your Own Key)

### Frontend
- **Next.js** (React) with vanilla CSS
- Real-time debate streaming via Server-Sent Events (SSE)

### Token Optimization
- Groq-powered pre-summarization (Llama-3-70B)
- Context history compression
- Semantic caching across agents

## 🚀 Quick Start

### 1. Backend Setup (Ubuntu / Linux)

```bash
# Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Copy and configure your API keys
cp .env.example .env
# Edit .env with your Groq/OpenAI/Anthropic API key

# Run the server
python server.py
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

### 3. Open the App

Navigate to `http://localhost:3000` and start a council!

## 📋 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GROQ_API_KEY` | Your Groq API key | Yes (if using Groq) |
| `OPENAI_API_KEY` | Your OpenAI API key | Yes (if using OpenAI) |
| `ANTHROPIC_API_KEY` | Your Anthropic API key | Yes (if using Anthropic) |
| `PRIMARY_LLM_PROVIDER` | Provider for debate agents (`groq`, `openai`, `anthropic`) | No (default: `groq`) |
| `PRIMARY_LLM_MODEL` | Model for debate agents | No (default: `llama-3.3-70b-versatile`) |

## 📁 Project Structure

```
TechHubAI/
├── server.py              # FastAPI server
├── requirements.txt       # Python dependencies
├── .env.example           # Environment variable template
├── swarm/                 # Backend Debate Engine
│   ├── __init__.py
│   ├── config.py           # BYOK configuration
│   ├── llm_client.py       # Unified LLM client (Groq/OpenAI/Anthropic)
│   ├── tools.py            # DuckDuckGo + Crawl4AI + summarization
│   ├── personas.py         # Agent personas & Judge prompts
│   └── engine.py           # Debate engine & orchestration
├── frontend/              # Next.js Application
│   ├── app/
│   │   ├── layout.tsx          # Root layout with SEO
│   │   ├── page.tsx            # Main page (debate UI)
│   │   └── globals.css         # Design system
│   └── package.json
└── README.md
```

## 🤝 Contributing

This is an open-source project! Contributions welcome.

## 📜 License

MIT
