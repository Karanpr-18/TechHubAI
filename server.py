"""
FastAPI Server for TechHubAI
====================================
Exposes the debate engine as a REST API with SSE (Server-Sent Events)
for real-time streaming of the debate to the frontend.
"""

import asyncio
import json
import uuid
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from swarm.config import SwarmConfig
from swarm.engine import DebateEngine, DebateMessage, UserPriorities


# ─── Session Store ────────────────────────────────────────────────────────────

# In-memory session store (for MVP; replace with Redis for production)
_sessions: dict[str, DebateEngine] = {}


def get_or_create_session(session_id: str, config: SwarmConfig) -> DebateEngine:
    """Get or create a debate engine session."""
    if session_id not in _sessions:
        _sessions[session_id] = DebateEngine(config)
    return _sessions[session_id]


# ─── App Setup ────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    config = SwarmConfig()
    issues = config.validate()
    if issues:
        print("⚠️  Configuration Issues:")
        for issue in issues:
            print(f"   - {issue}")
    else:
        print("✅ Configuration validated successfully.")
    print(f"🚀 TechHubAI API starting on {config.api_host}:{config.api_port}")
    yield
    print("👋 TechHubAI API shutting down.")


app = FastAPI(
    title="TechHubAI - The Tech Stack Council",
    description="Multi-agent debate system for tech stack recommendations",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request/Response Models ─────────────────────────────────────────────────

class StartDebateRequest(BaseModel):
    """Request to start a new debate session."""
    project_requirements: str
    provider: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    fallback_model: Optional[str] = None


class PrioritiesRequest(BaseModel):
    """User priority ratings for the final verdict."""
    session_id: str
    tech_difficulty: int = 5
    efficiency: int = 5
    latency: int = 5
    cost: int = 5
    maintainability: int = 5
    scalability: int = 5
    time_to_market: int = 5
    community_support: int = 5


class SessionResponse(BaseModel):
    """Response containing session info."""
    session_id: str
    status: str
    message: str


class DebateMessageResponse(BaseModel):
    """A single debate message."""
    agent_name: str
    agent_emoji: str
    agent_title: str
    round_number: int
    content: str


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "agent-swarm"}


@app.post("/api/debate/start", response_model=SessionResponse)
async def start_debate(request: StartDebateRequest):
    """
    Start a new debate session. Returns a session_id.
    The debate runs asynchronously; use the /stream endpoint to watch it.
    """
    session_id = str(uuid.uuid4())

    # Build config, optionally overriding with request-level BYOK
    config = SwarmConfig()
    if request.provider:
        config.primary_llm.provider = request.provider
        config.primary_llm.api_key = request.api_key or config.get_api_key(request.provider)
        if request.model:
            config.primary_llm.model = request.model
        if request.fallback_model:
            config.primary_llm.fallback_model = request.fallback_model

    engine = get_or_create_session(session_id, config)

    # Start the debate pipeline in the background
    asyncio.create_task(_run_debate_background(session_id, engine, request.project_requirements))

    return SessionResponse(
        session_id=session_id,
        status="started",
        message="Debate initiated. Use /api/debate/stream/{session_id} to watch the debate.",
    )


import traceback

async def _run_debate_background(session_id: str, engine: DebateEngine, requirements: str):
    """Run the debate pipeline in the background."""
    try:
        await engine.run_debate_pipeline(requirements)
    except Exception as e:
        traceback.print_exc()
        engine.state.status = "error"
        error_msg = DebateMessage(
            agent_name="System",
            agent_emoji="❌",
            agent_title="Error",
            round_number=-1,
            content=f"Debate failed: {str(e)}",
        )
        engine.state.messages.append(error_msg)


@app.get("/api/debate/stream/{session_id}")
async def stream_debate(session_id: str):
    """
    Stream the debate messages as Server-Sent Events (SSE).
    The frontend can connect to this to watch the debate in real-time.
    """
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    engine = _sessions[session_id]

    async def event_generator():
        last_idx = 0
        last_thinking_idx = 0
        while True:
            # Send any new thinking updates
            current_thinking = engine.state.thinking_updates
            if len(current_thinking) > last_thinking_idx:
                for update in current_thinking[last_thinking_idx:]:
                    data = json.dumps({
                        "type": "thinking",
                        "agent_name": update.agent_name,
                        "agent_emoji": update.agent_emoji,
                        "status_text": update.status_text,
                    })
                    yield f"data: {data}\n\n"
                last_thinking_idx = len(current_thinking)

            # Send any new messages
            current_messages = engine.state.messages
            if len(current_messages) > last_idx:
                for msg in current_messages[last_idx:]:
                    data = json.dumps({
                        "type": "message",
                        "agent_name": msg.agent_name,
                        "agent_emoji": msg.agent_emoji,
                        "agent_title": msg.agent_title,
                        "round_number": msg.round_number,
                        "content": msg.content,
                    })
                    yield f"data: {data}\n\n"
                last_idx = len(current_messages)

            # Check if debate is done or waiting for mid-debate input
            if engine.state.status == "waiting_for_mid_debate_input":
                # Emit the interjection question
                interjection_data = json.dumps({
                    "type": "interjection",
                    "question": engine.state.mid_debate_question,
                    "status": "waiting_for_mid_debate_input",
                })
                yield f"data: {interjection_data}\n\n"
                # Keep the stream alive and wait for the debate to resume
                while engine.state.status == "waiting_for_mid_debate_input":
                    await asyncio.sleep(0.5)
                # Once resumed, emit a status update
                resume_data = json.dumps({
                    "type": "status",
                    "status": "debating",
                })
                yield f"data: {resume_data}\n\n"

            if engine.state.status in ("alignment_chat", "complete", "error"):
                status_data = json.dumps({
                    "type": "status",
                    "status": engine.state.status,
                })
                yield f"data: {status_data}\n\n"
                break

            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.get("/api/debate/status/{session_id}")
async def get_debate_status(session_id: str):
    """Get the current status and all messages of a debate session."""
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    engine = _sessions[session_id]
    messages = [
        DebateMessageResponse(
            agent_name=m.agent_name,
            agent_emoji=m.agent_emoji,
            agent_title=m.agent_title,
            round_number=m.round_number,
            content=m.content,
        )
        for m in engine.state.messages
    ]

    return {
        "session_id": session_id,
        "status": engine.state.status,
        "messages": messages,
        "judge_synthesis": engine.state.judge_synthesis,
        "questionnaire": engine.state.questionnaire,
        "thinking_updates": [
            {
                "agent_name": u.agent_name,
                "agent_emoji": u.agent_emoji,
                "status_text": u.status_text,
            }
            for u in engine.state.thinking_updates
        ],
    }


class AlignRequest(BaseModel):
    session_id: str
    user_response: str


@app.post("/api/debate/align")
async def align_priorities(request: AlignRequest):
    """
    Submit a conversational response to the Judge.
    Runs a turn of alignment chat, returning either the next question or the final verdict.
    """
    if request.session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    engine = _sessions[request.session_id]

    if engine.state.status != "alignment_chat":
        raise HTTPException(
            status_code=400,
            detail=f"Session is in '{engine.state.status}' state. Expected 'alignment_chat'.",
        )

    result = await engine.process_alignment_turn(request.user_response)
    return {
        "session_id": request.session_id,
        **result
    }


class InterjectRequest(BaseModel):
    session_id: str
    user_answer: str


@app.post("/api/debate/interject")
async def submit_interjection(request: InterjectRequest):
    """
    Submit a user answer to a mid-debate Judge interjection question.
    This resumes the paused debate loop.
    """
    if request.session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    engine = _sessions[request.session_id]

    if engine.state.status != "waiting_for_mid_debate_input":
        raise HTTPException(
            status_code=400,
            detail=f"Session is in '{engine.state.status}' state. Expected 'waiting_for_mid_debate_input'.",
        )

    # Store the answer
    engine.state.mid_debate_answer = request.user_answer
    engine.state.mid_debate_answers.append({
        "question": engine.state.mid_debate_question,
        "answer": request.user_answer,
    })

    # Emit user answer as a debate message
    user_msg = DebateMessage(
        agent_name="User",
        agent_emoji="👤",
        agent_title="Mid-Debate Clarification",
        round_number=300,  # Special round number for mid-debate user answers
        content=request.user_answer,
    )
    engine.state.messages.append(user_msg)

    # Resume the debate loop
    if engine.state.user_interjection_event:
        engine.state.user_interjection_event.set()

    return {
        "session_id": request.session_id,
        "status": "resumed",
        "message": "Debate resumed with your clarification.",
    }


@app.post("/api/debate/priorities")
async def submit_priorities(request: PrioritiesRequest):
    """
    Submit user priority ratings and get the final verdict.
    This triggers the Judge's final optimization pass.
    """
    if request.session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    engine = _sessions[request.session_id]

    if engine.state.status != "awaiting_priorities":
        raise HTTPException(
            status_code=400,
            detail=f"Session is in '{engine.state.status}' state. Expected 'awaiting_priorities'.",
        )

    priorities = UserPriorities(
        tech_difficulty=request.tech_difficulty,
        efficiency=request.efficiency,
        latency=request.latency,
        cost=request.cost,
        maintainability=request.maintainability,
        scalability=request.scalability,
        time_to_market=request.time_to_market,
        community_support=request.community_support,
    )

    verdict = await engine.final_verdict(priorities)

    return {
        "session_id": request.session_id,
        "status": "complete",
        "final_verdict": verdict,
    }


@app.post("/api/debate/upload")
async def upload_project_file(file: UploadFile = File(...)):
    """
    Upload a project requirements file (txt, md, pdf).
    Returns the extracted text content.
    """
    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    return {
        "filename": file.filename,
        "content": text,
        "chars": len(text),
    }


# ─── Entry Point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    config = SwarmConfig()
    uvicorn.run(
        "server:app",
        host=config.api_host,
        port=config.api_port,
        reload=True,
    )
