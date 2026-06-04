# TechHubAI - Swarm Debate Engine 🐝

[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat&logo=next.js)](https://nextjs.org/)
[![Python](https://img.shields.io/badge/Python-3.10+-blue?style=flat&logo=python)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.109+-009688?style=flat&logo=fastapi)](https://fastapi.tiangolo.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

TechHubAI is a cutting-edge **Multi-Agent Swarm Debate Platform**. It orchestrates complex, multi-perspective debates between various LLMs to reach highly nuanced conclusions. Complete with a stunning, modern Claymorphic 3D UI, TechHubAI provides an unparalleled interactive AI experience.

## ✨ Features

- 🧠 **Multi-Agent Swarm Engine**: Watch multiple AI agents (Primary, Secondary, and Supervisor) debate complex topics in real-time.
- 🎨 **Premium Claymorphic UI**: A stunning, modern, animated 3D interface that feels alive and responsive.
- 🔄 **Intelligent Model Fallback**: Built-in rate-limit handling and automatic model fallbacks ensure uninterrupted debates even when API limits are reached.
- 🔌 **Multi-Provider Support**: Seamlessly use models from OpenAI, Anthropic, Google (Gemini), Groq, Mistral, and local Ollama instances.
- 🛠️ **Customizable Personas**: Define custom system prompts for each agent to tailor their perspective in the debate.
- 🌊 **Real-time Streaming**: Watch the debate unfold token-by-token with real-time streaming capabilities.

## 🚀 Quick Start

Ready to dive in? Check out our comprehensive setup guide for your operating system:

👉 **[Read the Setup Guide (Mac/Windows/Linux)](SETUP.md)**

## 🏗️ Architecture overview

The platform is divided into a robust Python backend and a blazing-fast Next.js frontend.

### Frontend (`/frontend`)
- **Framework**: Next.js 14 (React)
- **Styling**: Tailwind CSS with custom Claymorphism utilities
- **Animations**: Framer Motion
- **State**: React Hooks

### Backend (`/`)
- **Server**: FastAPI
- **LLM Orchestration**: Custom Swarm Engine
- **Providers**: `openai`, `anthropic`, `google-genai`, `groq`, `mistralai`
- **Streaming**: Server-Sent Events (SSE)

## 🤝 Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
