"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import SafeMarkdown from "./components/SafeMarkdown";

/* ═══════════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════════ */

interface DebateMessage {
  agent_name: string;
  agent_emoji: string;
  agent_title: string;
  round_number: number;
  content: string;
}

interface UserPriorities {
  tech_difficulty: number;
  efficiency: number;
  latency: number;
  cost: number;
  maintainability: number;
  scalability: number;
  time_to_market: number;
  community_support: number;
}

interface Settings {
  provider: string;
  model: string;
  api_key: string;
  api_url: string;
}

interface FactorInfo {
  status: "clear" | "ambiguous";
  rating: number;
  explanation: string;
  question: string;
}

type Questionnaire = Record<string, FactorInfo>;

type AppPhase =
  | "input"
  | "debating"
  | "alignment_chat"
  | "awaiting_priorities"
  | "finalizing"
  | "complete"
  | "error";

/* ═══════════════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════════════ */

const PRIORITY_FIELDS: {
  key: keyof UserPriorities;
  label: string;
  emoji: string;
  desc: string;
}[] = [
  {
    key: "tech_difficulty",
    label: "Ease of Learning",
    emoji: "📚",
    desc: "How simple should the stack be to learn?",
  },
  {
    key: "efficiency",
    label: "Performance",
    emoji: "⚡",
    desc: "How much does raw compute efficiency matter?",
  },
  {
    key: "latency",
    label: "Latency",
    emoji: "🏎️",
    desc: "How critical is sub-millisecond response time?",
  },
  {
    key: "cost",
    label: "Cost",
    emoji: "💰",
    desc: "How important is keeping infrastructure cheap?",
  },
  {
    key: "maintainability",
    label: "Maintainability",
    emoji: "🔧",
    desc: "How easy should it be to maintain long-term?",
  },
  {
    key: "scalability",
    label: "Scalability",
    emoji: "📈",
    desc: "How much does horizontal scaling matter?",
  },
  {
    key: "time_to_market",
    label: "Time to Market",
    emoji: "🚀",
    desc: "How fast do you need to ship?",
  },
  {
    key: "community_support",
    label: "Community & Ecosystem",
    emoji: "👥",
    desc: "How important is community support?",
  },
];

const DEFAULT_PRIORITIES: UserPriorities = {
  tech_difficulty: 5,
  efficiency: 5,
  latency: 5,
  cost: 5,
  maintainability: 5,
  scalability: 5,
  time_to_market: 5,
  community_support: 5,
};

const AGENT_CLASS_MAP: Record<string, string> = {
  "The Veteran": "veteran",
  "The Scaler": "scaler",
  "The Pioneer": "pioneer",
  "The Mad Scientist": "mad-scientist",
  "The Judge": "judge",
  System: "judge",
  User: "user",
};

/* ═══════════════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════════════ */

export default function Home() {
  // State
  const [phase, setPhase] = useState<AppPhase>("input");
  const [requirements, setRequirements] = useState("");
  const [messages, setMessages] = useState<DebateMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [judgeSynthesis, setJudgeSynthesis] = useState("");
  const [finalVerdict, setFinalVerdict] = useState("");
  const [priorities, setPriorities] =
    useState<UserPriorities>(DEFAULT_PRIORITIES);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    api_key: "",
    api_url: "http://localhost:8000",
  });
  const [error, setError] = useState<string | null>(null);
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null);
  const [userAlignmentResponse, setUserAlignmentResponse] = useState("");
  const [alignmentSubmitting, setAlignmentSubmitting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ─── API Helpers ───────────────────────────────────────────────── */

  const apiBase = settings.api_url;

  const startDebate = useCallback(async () => {
    if (!requirements.trim()) return;

    setPhase("debating");
    setMessages([]);
    setError(null);
    setJudgeSynthesis("");
    setFinalVerdict("");

    try {
      // Start the debate
      const res = await fetch(`${apiBase}/api/debate/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_requirements: requirements,
          provider: settings.provider,
          model: settings.model,
          api_key: settings.api_key || undefined,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to start debate: ${res.statusText}`);
      }

      const data = await res.json();
      setSessionId(data.session_id);

      // Connect to SSE stream
      const eventSource = new EventSource(
        `${apiBase}/api/debate/stream/${data.session_id}`
      );

      eventSource.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "status") {
            if (msg.status === "alignment_chat") {
              setPhase("alignment_chat");
              // Fetch the judge synthesis and messages
              fetch(`${apiBase}/api/debate/status/${data.session_id}`)
                .then((r) => r.json())
                .then((statusData) => {
                  setJudgeSynthesis(statusData.judge_synthesis || "");
                  setMessages(statusData.messages || []);
                });
            } else if (msg.status === "error") {
              setPhase("error");
              setError("The debate encountered an error.");
            }
            eventSource.close();
            return;
          }

          // It's a debate message
          setMessages((prev) => [...prev, msg as DebateMessage]);
        } catch {
          // Ignore malformed events
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        // If we haven't transitioned to a final phase, mark as error
        setPhase((prev) => {
          if (prev === "debating") return "error";
          return prev;
        });
      };
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [requirements, settings, apiBase]);

  const submitPriorities = useCallback(async () => {
    if (!sessionId) return;

    setPhase("finalizing");

    try {
      const res = await fetch(`${apiBase}/api/debate/priorities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          ...priorities,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to submit priorities: ${res.statusText}`);
      }

      const data = await res.json();
      setFinalVerdict(data.final_verdict);
      setPhase("complete");
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [sessionId, priorities, apiBase]);

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Read file contents locally
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result;
        if (typeof text === "string") {
          setRequirements(text);
        }
      };
      reader.readAsText(file);
    },
    []
  );

  const handleAlignmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAlignmentResponse.trim() || !sessionId) return;

    setAlignmentSubmitting(true);
    setError(null);

    // Optimistically add user response to local messages state for immediate display
    const userMsg = {
      agent_name: "User",
      agent_emoji: "👤",
      agent_title: "Clarification",
      round_number: 102,
      content: userAlignmentResponse,
    };
    setMessages((prev) => [...prev, userMsg]);
    const responseText = userAlignmentResponse;
    setUserAlignmentResponse("");

    try {
      const res = await fetch(`${apiBase}/api/debate/align`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          user_response: responseText,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to submit alignment response: ${res.statusText}`);
      }

      const data = await res.json();
      
      if (data.status === "complete") {
        setFinalVerdict(data.final_verdict);
        setPhase("complete");
      } else {
        // Fetch the full messages list from the backend to sync the Judge's next question
        const statusRes = await fetch(`${apiBase}/api/debate/status/${sessionId}`);
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          setMessages(statusData.messages || []);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAlignmentSubmitting(false);
    }
  };

  const resetAll = useCallback(() => {
    setPhase("input");
    setMessages([]);
    setSessionId(null);
    setJudgeSynthesis("");
    setFinalVerdict("");
    setPriorities(DEFAULT_PRIORITIES);
    setQuestionnaire(null);
    setUserAlignmentResponse("");
    setError(null);
  }, []);

  /* ─── Helpers ───────────────────────────────────────────────────── */

  const getAgentClass = (name: string): string => {
    return AGENT_CLASS_MAP[name] || "judge";
  };

  const getCurrentRound = (): number => {
    if (messages.length === 0) return 0;
    return Math.max(...messages.map((m) => m.round_number));
  };

  const getStepState = (
    stepPhases: AppPhase[]
  ): "complete" | "active" | "pending" => {
    if (stepPhases.includes(phase)) return "active";
    const phaseOrder: AppPhase[] = [
      "input",
      "debating",
      "alignment_chat",
      "awaiting_priorities",
      "finalizing",
      "complete",
    ];
    const currentIdx = phaseOrder.indexOf(phase);
    const stepIdx = phaseOrder.indexOf(stepPhases[0]);
    if (currentIdx > stepIdx) return "complete";
    return "pending";
  };

  /* ─── Render ────────────────────────────────────────────────────── */

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="header__logo">
          <span className="header__icon">🤖</span>
          <h1 className="header__title">Agent Swarm</h1>
        </div>
        <p className="header__subtitle">
          4 AI agents with radically different perspectives debate your project
          to find the perfect tech stack &amp; architecture.
        </p>
      </header>

      {/* Step Indicators */}
      <div className="steps">
        <StepIndicator
          number={1}
          label="Requirements"
          state={getStepState(["input"])}
        />
        <div
          className={`step__connector ${
            getStepState(["input"]) === "complete"
              ? "step__connector--active"
              : ""
          }`}
        />
        <StepIndicator
          number={2}
          label="Council Debate"
          state={getStepState(["debating"])}
        />
        <div
          className={`step__connector ${
            getStepState(["debating"]) === "complete"
              ? "step__connector--active"
              : ""
          }`}
        />
        <StepIndicator
          number={3}
          label="Your Priorities"
          state={getStepState(["alignment_chat", "awaiting_priorities"])}
        />
        <div
          className={`step__connector ${
            getStepState(["awaiting_priorities"]) === "complete"
              ? "step__connector--active"
              : ""
          }`}
        />
        <StepIndicator
          number={4}
          label="Final Verdict"
          state={getStepState(["finalizing", "complete"])}
        />
      </div>

      {/* Error Display */}
      {error && (
        <div
          className="status-bar"
          style={{ borderColor: "var(--accent-tertiary)" }}
        >
          <div className="status-bar__dot status-bar__dot--error" />
          <span className="status-bar__text">Error: {error}</span>
          <button className="btn btn--ghost" onClick={resetAll}>
            Reset
          </button>
        </div>
      )}

      {/* Phase 1: Input */}
      {phase === "input" && (
        <div className="input-section glass-card">
          <label className="input-section__label" htmlFor="requirements-input">
            📋 Project Requirements
          </label>
          <textarea
            id="requirements-input"
            className="input-section__textarea"
            placeholder={`Describe your project in detail. For example:\n\n"I want to build a real-time collaborative document editor like Notion, supporting up to 10,000 concurrent users. It needs rich text editing, commenting, version history, and real-time cursors. We have a team of 3 full-stack developers with experience in React and Python."`}
            value={requirements}
            onChange={(e) => setRequirements(e.target.value)}
          />

          <div className="input-section__actions">
            <button
              id="start-debate-btn"
              className="btn btn--primary"
              onClick={startDebate}
              disabled={!requirements.trim()}
            >
              ⚡ Start the Council
            </button>

            <div className="file-upload">
              <input
                type="file"
                id="file-upload-input"
                className="file-upload__input"
                accept=".txt,.md,.pdf,.doc,.docx"
                onChange={handleFileUpload}
              />
              <label htmlFor="file-upload-input" className="file-upload__label">
                📄 Upload File
              </label>
            </div>

            <button
              className="btn btn--ghost"
              onClick={() => setShowSettings(!showSettings)}
            >
              ⚙️ {showSettings ? "Hide" : "API"} Settings
            </button>
          </div>

          {/* BYOK Settings Panel */}
          {showSettings && (
            <div className="settings-panel">
              <h3 className="settings-panel__title">
                🔑 Bring Your Own Key (BYOK)
              </h3>
              <div className="settings-grid">
                <div className="settings-field">
                  <label className="settings-field__label">API Base URL</label>
                  <input
                    type="text"
                    className="settings-field__input"
                    value={settings.api_url}
                    onChange={(e) =>
                      setSettings({ ...settings, api_url: e.target.value })
                    }
                    placeholder="http://localhost:8000"
                  />
                </div>
                <div className="settings-field">
                  <label className="settings-field__label">LLM Provider</label>
                  <select
                    className="settings-field__select"
                    value={settings.provider}
                    onChange={(e) =>
                      setSettings({ ...settings, provider: e.target.value })
                    }
                  >
                    <option value="groq">Groq</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>
                <div className="settings-field">
                  <label className="settings-field__label">Model</label>
                  <input
                    type="text"
                    className="settings-field__input"
                    value={settings.model}
                    onChange={(e) =>
                      setSettings({ ...settings, model: e.target.value })
                    }
                    placeholder="llama-3.3-70b-versatile"
                  />
                </div>
                <div className="settings-field">
                  <label className="settings-field__label">
                    API Key (optional override)
                  </label>
                  <input
                    type="password"
                    className="settings-field__input"
                    value={settings.api_key}
                    onChange={(e) =>
                      setSettings({ ...settings, api_key: e.target.value })
                    }
                    placeholder="sk-..."
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Phase 2: Debate Stream */}
      {(phase === "debating" ||
        phase === "alignment_chat" ||
        phase === "awaiting_priorities" ||
        phase === "finalizing" ||
        phase === "complete") &&
        messages.length > 0 && (
          <div className="debate-stream">
            <div className="debate-stream__header">
              <h2 className="debate-stream__title">🏛️ Council Debate</h2>
              {phase === "debating" && (
                <div className="debate-stream__round-badge">
                  <div className="loading-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  Round {getCurrentRound() || 1}
                </div>
              )}
              {phase !== "debating" && (
                <div className="debate-stream__round-badge">
                  ✅ Debate Complete
                </div>
              )}
            </div>

            {/* Status Bar */}
            {phase === "debating" && (
              <div className="status-bar">
                <div className="status-bar__dot status-bar__dot--active" />
                <span className="status-bar__text">
                  Agents are debating... ({messages.length} messages)
                </span>
              </div>
            )}

            {/* Messages */}
            <div className="debate-stream__messages">
              {messages
                .filter((m) => m.round_number !== 99 && m.round_number !== 100)
                .map((msg, idx) => (
                  <div
                    key={idx}
                    className={`agent-message agent-message--${getAgentClass(
                      msg.agent_name
                    )}`}
                  >
                    <div className="agent-message__header">
                      <div className="agent-message__avatar">
                        {msg.agent_emoji}
                      </div>
                      <div className="agent-message__info">
                        <div className="agent-message__name">
                          {msg.agent_name}
                        </div>
                        <div className="agent-message__title">
                          {msg.agent_title}
                        </div>
                      </div>
                      <div className="agent-message__round">
                        {msg.round_number === 0
                          ? "Initial Proposal"
                          : `Round ${msg.round_number}`}
                      </div>
                    </div>
                    <div className="agent-message__content">
                      <SafeMarkdown content={msg.content} />
                    </div>
                  </div>
                ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Loading indicator during debate */}
            {phase === "debating" && (
              <div className="loading-indicator">
                <div className="loading-dots">
                  <span />
                  <span />
                  <span />
                </div>
                <span>Agents are thinking...</span>
              </div>
            )}
          </div>
        )}

      {/* Judge Synthesis Display */}
      {judgeSynthesis && phase !== "input" && (
        <div className="architecture-section">
          <div className="architecture-card">
            <div className="agent-message__header">
              <div className="agent-message__avatar">⚖️</div>
              <div className="agent-message__info">
                <div className="agent-message__name">The Judge</div>
                <div className="agent-message__title">
                  Synthesized Architectures
                </div>
              </div>
            </div>
            <div className="architecture-card__content">
              <SafeMarkdown content={judgeSynthesis} />
            </div>
          </div>
        </div>
      )}

      {/* Phase 3: Conversational Alignment Chat */}
      {phase === "alignment_chat" && (
        <div className="priorities-section glass-card">
          <h2 className="priorities-section__title">
            ⚖️ Clarify Priorities with the Judge
          </h2>
          <p className="priorities-section__subtitle" style={{ marginBottom: "1.5rem" }}>
            The Judge has initiated a conversational alignment session to resolve key trade-offs. Type your answers to the Judge in the box below.
          </p>

          <form onSubmit={handleAlignmentSubmit} style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
            <input
              type="text"
              className="settings-field__input"
              style={{ flex: 1, height: "45px", padding: "0.75rem 1rem", fontSize: "0.95rem" }}
              placeholder="Clarify your requirements for the Judge..."
              value={userAlignmentResponse}
              onChange={(e) => setUserAlignmentResponse(e.target.value)}
              disabled={alignmentSubmitting}
            />
            <button
              type="submit"
              className="btn btn--primary"
              style={{ height: "45px", padding: "0 1.5rem" }}
              disabled={alignmentSubmitting || !userAlignmentResponse.trim()}
            >
              {alignmentSubmitting ? "Sending..." : "Send"}
            </button>
          </form>
        </div>
      )}

      {/* Finalizing Indicator */}
      {phase === "finalizing" && (
        <div className="loading-indicator" style={{ padding: "3rem" }}>
          <div className="loading-dots">
            <span />
            <span />
            <span />
          </div>
          <span>
            The Judge is optimizing the tech stack based on your priorities...
          </span>
        </div>
      )}

      {/* Phase 4: Final Verdict */}
      {phase === "complete" && finalVerdict && (
        <div className="final-verdict">
          <div className="agent-message__header">
            <div className="agent-message__avatar">🏆</div>
            <div className="agent-message__info">
              <div className="agent-message__name">Final Verdict</div>
              <div className="agent-message__title">
                Optimized for your priorities
              </div>
            </div>
          </div>
          <div className="final-verdict__content">
            <SafeMarkdown content={finalVerdict} />
          </div>

          <div style={{ marginTop: "2rem", textAlign: "center" }}>
            <button className="btn btn--secondary" onClick={resetAll}>
              🔄 Start a New Council
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Sub-Components
   ═══════════════════════════════════════════════════════════════════════ */

function StepIndicator({
  number,
  label,
  state,
}: {
  number: number;
  label: string;
  state: "complete" | "active" | "pending";
}) {
  return (
    <div className={`step step--${state}`}>
      <div className="step__number">
        {state === "complete" ? "✓" : number}
      </div>
      <span>{label}</span>
    </div>
  );
}
