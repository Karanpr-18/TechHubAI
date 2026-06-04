# TechHubAI Setup Guide 🛠️

Welcome to the TechHubAI Setup Guide! This document will walk you through the process of setting up the project on your local machine, whether you're using macOS, Windows, or Linux.

## 📋 Prerequisites

Before you begin, ensure you have the following installed on your system:
- **Node.js** (v18.0.0 or higher) - [Download](https://nodejs.org/)
- **Python** (v3.10 or higher) - [Download](https://www.python.org/)
- **Git** - [Download](https://git-scm.com/)

---

## 🚀 Step 1: Clone the Repository

Open your terminal or command prompt and clone the repository:

```bash
git clone https://github.com/yourusername/TechHubAI.git
cd TechHubAI
```

---

## 🐍 Step 2: Backend Setup

The backend is powered by Python. We recommend using a virtual environment.

### 🍎 macOS / 🐧 Linux

1. **Create a virtual environment:**
   ```bash
   python3 -m venv venv
   ```

2. **Activate the virtual environment:**
   ```bash
   source venv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

### 🪟 Windows

1. **Create a virtual environment:**
   ```cmd
   python -m venv venv
   ```

2. **Activate the virtual environment:**
   ```cmd
   venv\Scripts\activate
   ```

3. **Install dependencies:**
   ```cmd
   pip install -r requirements.txt
   ```

---

## 🔑 Step 3: Environment Variables

You need to provide API keys for the LLM providers you intend to use.

1. In the root directory (where `server.py` is located), create a file named `.env`.
2. Add your API keys to the `.env` file. You only need to add keys for the providers you plan to use:

```env
# OpenAI
OPENAI_API_KEY=your_openai_api_key_here

# Anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Google (Gemini)
GOOGLE_API_KEY=your_google_api_key_here

# Groq
GROQ_API_KEY=your_groq_api_key_here

# Mistral
MISTRAL_API_KEY=your_mistral_api_key_here
```

---

## 🖥️ Step 4: Frontend Setup

The frontend is built with Next.js and lives in the `frontend` directory.

1. **Navigate to the frontend directory:**
   ```bash
   cd frontend
   ```

2. **Install npm dependencies:**
   ```bash
   npm install
   ```

---

## 🏃 Step 5: Running the Application

You will need to run both the backend server and the frontend development server simultaneously.

### Terminal 1: Start the Backend

Make sure your virtual environment is activated and you are in the root directory of the project.

```bash
# macOS / Linux / Windows
python server.py
```
*The backend should now be running on http://localhost:8000*

### Terminal 2: Start the Frontend

Open a new terminal window, navigate to the `frontend` directory, and start the Next.js app.

```bash
cd frontend
npm run dev
```
*The frontend should now be running on http://localhost:3000*

---

## 🎉 You're all set!

Open your browser and navigate to **[http://localhost:3000](http://localhost:3000)**. You can now configure your Swarm agents, select your models, and start the debate!

### Troubleshooting

- **Rate Limits (429 Errors):** The app includes an intelligent fallback mechanism. If your primary model hits a rate limit, it will automatically attempt to use smaller fallback models or alternative providers configured in your `.env`.
- **CORS Issues:** Ensure your backend `server.py` has CORS configured to accept requests from `http://localhost:3000`.
