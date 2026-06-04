<div align="center">
  <img src="https://raw.githubusercontent.com/tandpfun/skill-icons/main/icons/NextJS-Dark.svg" width="60" alt="Next.js" />
  &nbsp;
  <img src="https://raw.githubusercontent.com/tandpfun/skill-icons/main/icons/Python-Dark.svg" width="60" alt="Python" />
  &nbsp;
  <img src="https://raw.githubusercontent.com/tandpfun/skill-icons/main/icons/FastAPI.svg" width="60" alt="FastAPI" />
  
  <br />
  <br />
  
  <h1>🌟 TechHubAI</h1>
  <h3>The Next-Generation Multi-Agent Swarm Debate Engine</h3>
  
  <p>
    <strong>Observe complex, AI-driven debates orchestrated by multiple independent LLM agents in a visually stunning, real-time interactive environment.</strong>
  </p>
  
  <p>
    <a href="#-features">Features</a> •
    <a href="#-the-swarm-architecture">Architecture</a> •
    <a href="#-getting-started">Getting Started</a> •
    <a href="#-ui-design-philosophy">UI Philosophy</a> •
    <a href="SETUP.md">Detailed Setup</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Next.js-14-000000?style=for-the-badge&logo=next.js" alt="Next.js">
    <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
    <img src="https://img.shields.io/badge/Framer_Motion-0055FF?style=for-the-badge&logo=framer&logoColor=white" alt="Framer Motion">
    <img src="https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python">
    <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI">
    <img src="https://img.shields.io/badge/Agentic_Framework-AgentScope-FF4B4B?style=for-the-badge" alt="AgentScope">
  </p>
</div>

---

## 📖 Overview

**TechHubAI** is a platform built to explore cognitive synergy between Large Language Models (LLMs). Rather than asking a single model for an answer, TechHubAI sets up a **Swarm Debate**. You define the topic, the models, and their respective personas, and watch as they debate the issue, critique each other's points, and are ultimately guided by a Supervisor agent towards a comprehensive conclusion.

Whether you are evaluating model reasoning capabilities, researching complex topics, or just want to see how Mistral argues with GPT-4, TechHubAI provides the perfect arena.

---

## ✨ Core Features

<table>
  <tr>
    <td width="50%">
      <h3>🧠 Multi-Agent Swarm</h3>
      Watch independent AI agents (Primary, Secondary, and Supervisor) interact, debate, and summarize complex topics. Each agent is aware of the context and the preceding arguments.
    </td>
    <td width="50%">
      <h3>🎨 Premium Claymorphic UI</h3>
      A stunning, animated 3D interface that breaks away from traditional flat web design. Built with Framer Motion and custom CSS, it feels tactile, responsive, and alive.
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>🔄 Intelligent Model Fallback</h3>
      Never drop a debate due to API rate limits (429s). The engine features a robust, automatic fallback mechanism that cascades down to smaller models or alternative providers instantly.
    </td>
    <td width="50%">
      <h3>🔌 Multi-Provider Support</h3>
      Bring your own API keys for seamless integration with: <strong>OpenAI</strong>, <strong>Anthropic</strong>, <strong>Google (Gemini)</strong>, <strong>Groq</strong>, <strong>Mistral</strong>, and local models via <strong>Ollama</strong>.
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>🌊 Real-time Streaming</h3>
      No waiting for long responses. The platform uses Server-Sent Events (SSE) to stream the debate token-by-token directly to the UI for an immersive experience.
    </td>
    <td width="50%">
      <h3>🛠️ Highly Configurable</h3>
      Adjust agent personas, debate topics, model selection, temperature, and fallback behaviors entirely from the frontend UI before launching the debate.
    </td>
  </tr>
</table>

---

## 🏗️ The Swarm Architecture

The core of TechHubAI is powered by **AgentScope**, providing a robust, multi-agent foundation seamlessly integrated with our custom state machine. It operates on a hierarchical, multi-agent system designed to simulate a structured debate.

Here is how the architecture flows from start to finish:

1. **User Input & Configuration**: It begins in the Next.js frontend, where you define the debate topic and configure the personas and models for each agent.
2. **The Supervisor Agent**: Once the debate starts, the FastAPI backend hands control over to the **Supervisor Agent**. The Supervisor acts as the moderator—it oversees the debate rounds and is ultimately responsible for synthesizing the arguments into a final conclusion.
3. **The Debaters (Primary & Secondary)**: The core of the debate happens between the **Primary Agent** and the **Secondary Agent**. 
   - The Primary Agent kicks things off by formulating initial arguments based on its assigned persona.
   - The Secondary Agent then analyzes those points and responds with counter-arguments from its own distinct perspective.
4. **Independent LLM Providers**: Each of these three agents can be powered by entirely different LLM providers (for example, you can have OpenAI's GPT-4 debating Anthropic's Claude 3).
5. **Real-Time Streaming**: As the agents "think" and generate text, the backend streams their responses token-by-token back to the user interface, creating a live, interactive viewing experience.

### 🔁 The Fallback Cascade

Our intelligent token rate-limiter catches `429 Too Many Requests` errors and immediately retries the prompt using a predefined cascade:
1. **User Fallback**: The specific fallback model selected in the UI settings.
2. **Internal Cascade**: Smaller, faster models from the same provider (e.g., `gpt-4o` -> `gpt-3.5-turbo`).
3. **Cross-Provider**: If the primary provider is completely exhausted, the system falls back to secondary providers configured in the `.env` file (e.g., failing over from Anthropic to Mistral).

---

## 🎨 UI Design Philosophy

TechHubAI utilizes **Claymorphism**, a modern UI trend that combines:
- Soft, pillowy 3D shapes.
- Inner shadows and highlights for a tactile feel.
- A four-point artificial "studio lighting" system implemented purely in CSS.
- Fluid, physics-based micro-interactions powered by Framer Motion.

The goal is to make the AI agents feel like physical entities operating within an interactive digital arena, moving away from the standard "chat bubble" interface.

---

## 🛠️ Technology Stack

### Frontend
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript / React
- **Styling**: Custom CSS (Vanilla CSS Variables & Claymorphism)
- **Animations**: Framer Motion
- **Icons**: Lucide React

### Backend
- **Framework**: FastAPI (Python 3.10+)
- **Agentic Engine**: AgentScope (v2.0.0+)
- **Concurrency**: Uvicorn, asyncio
- **Tools**: Crawl4AI, DuckDuckGo Search
- **Streaming**: Server-Sent Events (SSE)

---

## 🚀 Getting Started

Setting up TechHubAI locally is designed to be straightforward.

For full, step-by-step instructions across **macOS**, **Windows**, and **Linux**, please refer to our dedicated setup guide:

### 👉 [Read the Comprehensive SETUP.md](SETUP.md)

### Quick Start Preview

1. **Clone the repo**
   ```bash
   git clone https://github.com/yourusername/TechHubAI.git
   cd TechHubAI
   ```
2. **Setup the Backend** (Create a virtual environment and install requirements)
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use: venv\Scripts\activate
   pip install -r requirements.txt
   ```
3. **Configure Environment** (Create a `.env` file and add your API keys)
   ```env
   OPENAI_API_KEY=sk-...
   MISTRAL_API_KEY=...
   ```
4. **Run the Backend**
   ```bash
   python server.py
   ```
5. **Run the Frontend** (In a new terminal)
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
6. **Access the App**: Navigate to `http://localhost:3000`

---

## 🗺️ Roadmap

- [x] Initial Swarm Engine (Primary, Secondary, Supervisor)
- [x] Multi-Provider Integration (OpenAI, Anthropic, Groq, Google)
- [x] Mistral Support & Model Fallback System
- [x] Real-time SSE Streaming
- [x] Claymorphic 3D UI
- [ ] Implement Memory/Context retention across sessions
- [ ] Export debate transcripts as PDF/Markdown
- [ ] Add support for custom local models via vLLM / LM Studio

---

## 🤝 Contributing

We welcome contributions from the community! Whether it's adding a new LLM provider, tweaking the CSS, or improving the Swarm logic.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Please ensure your code passes basic linting and you've tested the backend with `pytest` (if available).

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  <p>Built with ❤️ for the AI open-source community.</p>
</div>
