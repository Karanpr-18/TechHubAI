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

interface ThinkingUpdate {
  agent_name: string;
  agent_emoji: string;
  status_text: string;
  timestamp?: string;
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
   Helper Functions
   ═══════════════════════════════════════════════════════════════════════ */

function getSummary(content: string): string {
  if (!content) return "";
  let clean = content
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1");

  const sentences = clean.split(/[.!?]+\s+/);
  if (sentences.length > 0) {
    const summary = sentences.slice(0, 2).join(". ").trim();
    if (summary.length > 30) {
      return summary + (summary.endsWith(".") ? "" : ".");
    }
  }
  return clean.slice(0, 160).trim() + (clean.length > 160 ? "..." : "");
}

/* ═══════════════════════════════════════════════════════════════════════
   Swarm Graph SVG Component
   ═══════════════════════════════════════════════════════════════════════ */

function SwarmGraph({ activeAgent }: { activeAgent: string | null }) {
  const nodes = [
    { name: "The Veteran", emoji: "🏛️", x: 120, y: 80, color: "#8b9dc3" },
    { name: "The Scaler", emoji: "🚀", x: 380, y: 80, color: "#00d4aa" },
    { name: "The Mad Scientist", emoji: "🧪", x: 380, y: 320, color: "#ffa94d" },
    { name: "The Pioneer", emoji: "⚡", x: 120, y: 320, color: "#ff6b6b" },
    { name: "The Judge", emoji: "⚖️", x: 250, y: 200, color: "#7c5cfc" },
  ];

  const connections = [
    { from: "The Veteran", to: "The Scaler" },
    { from: "The Scaler", to: "The Mad Scientist" },
    { from: "The Mad Scientist", to: "The Pioneer" },
    { from: "The Pioneer", to: "The Veteran" },
    { from: "The Veteran", to: "The Judge" },
    { from: "The Scaler", to: "The Judge" },
    { from: "The Mad Scientist", to: "The Judge" },
    { from: "The Pioneer", to: "The Judge" },
  ];

  return (
    <div className="swarm-graph-container">
      <svg width="100%" height="100%" viewBox="0 0 500 400" className="swarm-svg">
        <defs>
          <radialGradient id="judge-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#7c5cfc" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#7c5cfc" stopOpacity="0" />
          </radialGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <circle cx="250" cy="200" r="120" fill="url(#judge-glow)" />

        {connections.map((conn, idx) => {
          const fromNode = nodes.find((n) => n.name === conn.from)!;
          const toNode = nodes.find((n) => n.name === conn.to)!;
          const isActive = activeAgent === conn.from || activeAgent === conn.to;

          return (
            <line
              key={idx}
              x1={fromNode.x}
              y1={fromNode.y}
              x2={toNode.x}
              y2={toNode.y}
              className={`swarm-line ${isActive ? "swarm-line--active" : ""}`}
            />
          );
        })}

        {nodes.map((node, idx) => {
          const isActive = activeAgent === node.name;
          const isJudge = node.name === "The Judge";

          return (
            <g key={idx} className={`swarm-node ${isActive ? "swarm-node--active" : ""}`}>
              {(isActive || isJudge) && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={isJudge ? 38 : 32}
                  fill={node.color}
                  opacity="0.2"
                  className="swarm-node-pulse"
                />
              )}

              <circle
                cx={node.x}
                cy={node.y}
                r={isJudge ? 28 : 24}
                fill="#16161f"
                stroke={isActive ? node.color : "rgba(255,255,255,0.15)"}
                strokeWidth={isActive ? 3 : 1.5}
                filter={isActive ? "url(#glow)" : undefined}
                className="swarm-node-bg"
              />

              <text
                x={node.x}
                y={node.y + 6}
                textAnchor="middle"
                fontSize={isJudge ? "1.4rem" : "1.2rem"}
                className="swarm-node-emoji"
              >
                {node.emoji}
              </text>

              <text
                x={node.x}
                y={node.y + (isJudge ? 42 : 38)}
                textAnchor="middle"
                fill={isActive ? node.color : "#8888a0"}
                fontSize="0.75rem"
                fontWeight={isActive ? "700" : "500"}
                className="swarm-node-label"
              >
                {node.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════════════ */

export default function Home() {
  const [phase, setPhase] = useState<AppPhase>("input");
  const [requirements, setRequirements] = useState("");
  const [messages, setMessages] = useState<DebateMessage[]>([]);
  const [thinkingUpdates, setThinkingUpdates] = useState<ThinkingUpdate[]>([]);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Record<number, boolean>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [judgeSynthesis, setJudgeSynthesis] = useState("");
  const [finalVerdict, setFinalVerdict] = useState("");
  const [priorities, setPriorities] = useState<UserPriorities>(DEFAULT_PRIORITIES);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    api_key: "",
    api_url: "http://localhost:8000",
  });
  const [error, setError] = useState<string | null>(null);
  const [userAlignmentResponse, setUserAlignmentResponse] = useState("");
  const [alignmentSubmitting, setAlignmentSubmitting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-scroll thinking logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thinkingUpdates]);

  const apiBase = settings.api_url;

  const toggleMessage = (idx: number) => {
    setExpandedMessages((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const startDebate = useCallback(async () => {
    if (!requirements.trim()) return;

    setPhase("debating");
    setMessages([]);
    setThinkingUpdates([]);
    setActiveAgent(null);
    setExpandedMessages({});
    setError(null);
    setJudgeSynthesis("");
    setFinalVerdict("");

    try {
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

      const eventSource = new EventSource(`${apiBase}/api/debate/stream/${data.session_id}`);

      eventSource.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "thinking") {
            const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
            setThinkingUpdates((prev) => [...prev, { ...msg, timestamp: time }]);
            setActiveAgent(msg.agent_name);
            return;
          }

          if (msg.type === "status") {
            setPhase(msg.status);
            setActiveAgent(null);
            if (msg.status === "alignment_chat") {
              fetch(`${apiBase}/api/debate/status/${data.session_id}`)
                .then((r) => r.json())
                .then((statusData) => {
                  setJudgeSynthesis(statusData.judge_synthesis || "");
                  setMessages(statusData.messages || []);
                  const logs = statusData.thinking_updates?.map((u: any) => ({
                    ...u,
                    timestamp: u.timestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                  })) || [];
                  setThinkingUpdates(logs);
                });
            } else if (msg.status === "error") {
              setPhase("error");
              setError("The debate encountered an error.");
            }
            eventSource.close();
            return;
          }

          setMessages((prev) => [...prev, msg as DebateMessage]);
          setActiveAgent(null);
        } catch {
          // Ignore malformed events
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
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

  const handleAlignmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAlignmentResponse.trim() || !sessionId) return;

    setAlignmentSubmitting(true);
    setError(null);

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
        setActiveAgent(null);
      } else {
        const statusRes = await fetch(`${apiBase}/api/debate/status/${sessionId}`);
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          setMessages(statusData.messages || []);
          const logs = statusData.thinking_updates?.map((u: any) => ({
            ...u,
            timestamp: u.timestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
          })) || [];
          setThinkingUpdates(logs);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAlignmentSubmitting(false);
    }
  };

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

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

  const resetAll = useCallback(() => {
    setPhase("input");
    setMessages([]);
    setThinkingUpdates([]);
    setActiveAgent(null);
    setExpandedMessages({});
    setSessionId(null);
    setJudgeSynthesis("");
    setFinalVerdict("");
    setPriorities(DEFAULT_PRIORITIES);
    setUserAlignmentResponse("");
    setError(null);
  }, []);

  const getAgentClass = (name: string): string => {
    return AGENT_CLASS_MAP[name] || "judge";
  };

  const getCurrentRound = (): number => {
    if (messages.length === 0) return 0;
    return Math.max(...messages.map((m) => m.round_number));
  };

  const getStepState = (stepPhases: AppPhase[]): "complete" | "active" | "pending" => {
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
        <StepIndicator number={1} label="Requirements" state={getStepState(["input"])} />
        <div className={`step__connector ${getStepState(["input"]) === "complete" ? "step__connector--active" : ""}`} />
        <StepIndicator number={2} label="Council Debate" state={getStepState(["debating"])} />
        <div className={`step__connector ${getStepState(["debating"]) === "complete" ? "step__connector--active" : ""}`} />
        <StepIndicator number={3} label="Your Priorities" state={getStepState(["alignment_chat", "awaiting_priorities"])} />
        <div className={`step__connector ${getStepState(["awaiting_priorities"]) === "complete" ? "step__connector--active" : ""}`} />
        <StepIndicator number={4} label="Final Verdict" state={getStepState(["finalizing", "complete"])} />
      </div>

      {/* Error Display */}
      {error && (
        <div className="status-bar" style={{ borderColor: "var(--accent-tertiary)" }}>
          <div className="status-bar__dot status-bar__dot--error" />
          <span className="status-bar__text">Error: {error}</span>
          <button className="btn btn--ghost" onClick={resetAll}>Reset</button>
        </div>
      )}

      {/* Phase 1: Input */}
      {phase === "input" && (
        <div className="input-section glass-card">
          <label className="input-section__label" htmlFor="requirements-input">📋 Project Requirements</label>
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
              <label htmlFor="file-upload-input" className="file-upload__label">📄 Upload File</label>
            </div>

            <button className="btn btn--ghost" onClick={() => setShowSettings(!showSettings)}>
              ⚙️ {showSettings ? "Hide" : "API"} Settings
            </button>
          </div>

          {/* BYOK Settings Panel */}
          {showSettings && (
            <div className="settings-panel">
              <h3 className="settings-panel__title">🔑 Bring Your Own Key (BYOK)</h3>
              <div className="settings-grid">
                <div className="settings-field">
                  <label className="settings-field__label">API Base URL</label>
                  <input
                    type="text"
                    className="settings-field__input"
                    value={settings.api_url}
                    onChange={(e) => setSettings({ ...settings, api_url: e.target.value })}
                    placeholder="http://localhost:8000"
                  />
                </div>
                <div className="settings-field">
                  <label className="settings-field__label">LLM Provider</label>
                  <select
                    className="settings-field__select"
                    value={settings.provider}
                    onChange={(e) => setSettings({ ...settings, provider: e.target.value })}
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
                    onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                    placeholder="llama-3.3-70b-versatile"
                  />
                </div>
                <div className="settings-field">
                  <label className="settings-field__label">API Key (optional override)</label>
                  <input
                    type="password"
                    className="settings-field__input"
                    value={settings.api_key}
                    onChange={(e) => setSettings({ ...settings, api_key: e.target.value })}
                    placeholder="sk-..."
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Split Dashboard (Phase 2 & onwards) */}
      {phase !== "input" && (
        <div className="swarm-dashboard">
          {/* Left Side: Swarm Visualizer & Message Stream */}
          <div className="swarm-dashboard__left">
            <div className="glass-card swarm-graph-card">
              <h3 className="swarm-graph-card__title">📡 Live Swarm Topology</h3>
              <SwarmGraph activeAgent={activeAgent} />
            </div>

            {messages.length > 0 && (
              <div className="debate-stream">
                <div className="debate-stream__header">
                  <h2 className="debate-stream__title">🏛️ Council Debate Feed</h2>
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
                    <div className="debate-stream__round-badge">✅ Debate Complete</div>
                  )}
                </div>

                {phase === "debating" && (
                  <div className="status-bar">
                    <div className="status-bar__dot status-bar__dot--active" />
                    <span className="status-bar__text">
                      Swarm debating... ({messages.length} messages)
                    </span>
                  </div>
                )}

                <div className="debate-stream__messages">
                  {messages
                    .filter((m) => m.round_number !== 99 && m.round_number !== 100)
                    .map((msg, idx) => {
                      const isExpanded = !!expandedMessages[idx];
                      const summary = getSummary(msg.content);
                      const showToggle = msg.content.length > 160;

                      return (
                        <div
                          key={idx}
                          className={`agent-message agent-message--${getAgentClass(msg.agent_name)}`}
                        >
                          <div className="agent-message__header">
                            <div className="agent-message__avatar">{msg.agent_emoji}</div>
                            <div className="agent-message__info">
                              <div className="agent-message__name">{msg.agent_name}</div>
                              <div className="agent-message__title">{msg.agent_title}</div>
                            </div>
                            <div className="agent-message__round">
                              {msg.round_number === 0 ? "Initial Proposal" : `Round ${msg.round_number}`}
                            </div>
                          </div>
                          <div className="agent-message__content">
                            {isExpanded ? (
                              <SafeMarkdown content={msg.content} />
                            ) : (
                              <p className="agent-message__summary">{summary}</p>
                            )}

                            {showToggle && (
                              <button
                                className="agent-message__toggle-btn"
                                onClick={() => toggleMessage(idx)}
                              >
                                {isExpanded ? "Collapse arguments ▲" : "Show full analysis ▼"}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  <div ref={messagesEndRef} />
                </div>

                {phase === "debating" && (
                  <div className="loading-indicator">
                    <div className="loading-dots">
                      <span />
                      <span />
                      <span />
                    </div>
                    <span>Swarm agents are computing...</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Side: Activity log ticker */}
          <div className="swarm-dashboard__right glass-card thinking-log-card">
            <h3 className="thinking-log-title">⚡ Swarm Activity Logs</h3>
            <div className="thinking-log-stream">
              {thinkingUpdates.length === 0 ? (
                <div className="thinking-log-empty">
                  <div className="loading-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <p>Bootstrapping Agent Swarm...</p>
                </div>
              ) : (
                thinkingUpdates.map((update, idx) => (
                  <div key={idx} className="thinking-log-item">
                    <span className="thinking-log-time">[{update.timestamp || ""}]</span>
                    <span className="thinking-log-emoji">{update.agent_emoji}</span>
                    <span className="thinking-log-text">
                      <strong>{update.agent_name}</strong>: {update.status_text}
                    </span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
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
                <div className="agent-message__title">Synthesized Architectures</div>
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
          <h2 className="priorities-section__title">⚖️ Clarify Priorities with the Judge</h2>
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
          <span>The Judge is optimizing the tech stack based on your priorities...</span>
        </div>
      )}

      {/* Phase 4: Final Verdict */}
      {phase === "complete" && finalVerdict && (
        <div className="final-verdict">
          <div className="agent-message__header">
            <div className="agent-message__avatar">🏆</div>
            <div className="agent-message__info">
              <div className="agent-message__name">Final Verdict</div>
              <div className="agent-message__title">Optimized for your priorities</div>
            </div>
          </div>
          <div className="final-verdict__content">
            <SafeMarkdown content={finalVerdict} />
          </div>

          <div style={{ marginTop: "2rem", textAlign: "center" }}>
            <button className="btn btn--secondary" onClick={resetAll}>🔄 Start a New Council</button>
          </div>
        </div>
      )}
    </div>
  );
}

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
      <div className="step__number">{state === "complete" ? "✓" : number}</div>
      <span>{label}</span>
    </div>
  );
}
