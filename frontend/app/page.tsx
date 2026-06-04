"use client";
import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Html, OrbitControls } from "@react-three/drei";
import { motion, AnimatePresence } from "framer-motion";
import * as THREE from "three";
import SafeMarkdown from "./components/SafeMarkdown";

/* ═══════════════════════════════════════════════════════════════════════
   Types & Configurations
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

interface Settings {
  provider: string;
  model: string;
  api_key: string;
  api_url: string;
}

type AppPhase =
  | "input"
  | "debating"
  | "waiting_for_mid_debate_input"
  | "alignment_chat"
  | "awaiting_priorities"
  | "finalizing"
  | "complete"
  | "error";

const AGENT_CLASS_MAP: Record<string, string> = {
  "The Veteran": "veteran",
  "The Scaler": "scaler",
  "The Pioneer": "pioneer",
  "The Mad Scientist": "mad-scientist",
  "The Judge": "judge",
  System: "system",
  User: "user",
};

const AGENT_COLORS: Record<string, string> = {
  "The Veteran": "#8d98a6",
  "The Scaler": "#6a8c7b",
  "The Pioneer": "#c98276",
  "The Mad Scientist": "#d4a373",
  "The Judge": "#9c8a77",
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
      return summary.slice(0, 160) + (summary.length > 160 ? "..." : "");
    }
  }
  return clean.slice(0, 160).trim() + (clean.length > 160 ? "..." : "");
}

/* ═══════════════════════════════════════════════════════════════════════
   3D Swarm Components (Clay & Glass Theme)
   ═══════════════════════════════════════════════════════════════════════ */

interface AgentNodeProps {
  position: [number, number, number];
  color: string;
  emoji: string;
  name: string;
  isActive: boolean;
  isJudge?: boolean;
  onClick: () => void;
}

function AgentOrb({ position, color, isActive, isJudge, emoji, name, onClick }: AgentNodeProps) {
  const coreRef = useRef<THREE.Mesh>(null);
  const outerGlassRef = useRef<THREE.Mesh>(null);
  const targetScale = isActive ? 1.4 : 1;
  const baseSize = isJudge ? 0.45 : 0.32;

  useFrame((state) => {
    if (coreRef.current) {
      coreRef.current.scale.lerp(
        new THREE.Vector3(targetScale, targetScale, targetScale),
        0.1
      );
    }
    if (outerGlassRef.current) {
      const pulse = Math.sin(state.clock.elapsedTime * 3) * 0.05 + 1.2;
      const glassScale = isActive ? targetScale * pulse : targetScale * 1.2;
      outerGlassRef.current.scale.lerp(
        new THREE.Vector3(glassScale, glassScale, glassScale),
        0.08
      );
    }
  });

  return (
    <Float speed={isActive ? 3.5 : 1.2} rotationIntensity={0.1} floatIntensity={isActive ? 0.45 : 0.15}>
      <group position={position}>
        {/* Outer glass sphere overlay */}
        <mesh
          ref={outerGlassRef}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          onPointerOver={() => {
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            document.body.style.cursor = "default";
          }}
        >
          <sphereGeometry args={[baseSize, 32, 32]} />
          <meshPhysicalMaterial
            color={color}
            transparent
            opacity={isActive ? 0.45 : 0.15}
            roughness={0.08}
            transmission={0.85}
            thickness={0.35}
            clearcoat={1.0}
            clearcoatRoughness={0.1}
          />
        </mesh>

        {/* Inner solid clay core */}
        <mesh ref={coreRef}>
          <sphereGeometry args={[baseSize * 0.78, 32, 32]} />
          <meshStandardMaterial
            color={color}
            roughness={0.65}
            metalness={0.02}
          />
        </mesh>

        {/* Shadow dot underneath representing ambient occlusion */}
        <mesh position={[0, -baseSize * 1.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[baseSize * 1.2, baseSize * 1.2]} />
          <meshBasicMaterial
            color="#5a5046"
            transparent
            opacity={isActive ? 0.18 : 0.06}
            depthWrite={false}
          />
        </mesh>

        {/* Agent label badge */}
        <Html center distanceFactor={8} style={{ pointerEvents: "none" }}>
          <div
            style={{
              textAlign: "center",
              color: isActive ? "#2b2927" : "#6e6a64",
              fontFamily: "'Outfit', sans-serif",
              fontWeight: isActive ? 700 : 500,
              fontSize: isJudge ? "11px" : "10px",
              whiteSpace: "nowrap",
              padding: "4px 10px",
              background: "rgba(255, 255, 255, 0.88)",
              border: `1px solid ${isActive ? color : "rgba(138, 115, 85, 0.12)"}`,
              borderRadius: "20px",
              boxShadow: "0 6px 16px rgba(120, 110, 95, 0.06)",
              transform: "translateY(38px)",
              transition: "all 0.3s ease",
            }}
          >
            <div style={{ fontSize: isJudge ? "20px" : "16px", marginBottom: 2 }}>{emoji}</div>
            {name}
          </div>
        </Html>
      </group>
    </Float>
  );
}

function DataPacket({
  start,
  end,
  speed,
  color,
}: {
  start: [number, number, number];
  end: [number, number, number];
  speed: number;
  color: string;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const phase = useMemo(() => Math.random() * 5, []);

  useFrame((state) => {
    if (ref.current) {
      const time = state.clock.elapsedTime + phase;
      const t = (time * speed) % 1.0;
      ref.current.position.set(
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
        start[2] + (end[2] - start[2]) * t
      );
    }
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.045, 12, 12]} />
      <meshStandardMaterial
        color={color}
        roughness={0.4}
        metalness={0.05}
        emissive={color}
        emissiveIntensity={0.5}
      />
    </mesh>
  );
}

function ConnectionLine({
  start,
  end,
  isActive,
  color,
}: {
  start: [number, number, number];
  end: [number, number, number];
  isActive: boolean;
  color: string;
}) {
  const lineRef = useRef<THREE.Line>(null);

  const lineObj = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...start),
      new THREE.Vector3(...end),
    ]);
    const material = new THREE.LineBasicMaterial({
      color: "#8a7355",
      transparent: true,
      opacity: 0.12,
    });
    return new THREE.Line(geometry, material);
  }, [start, end]);

  useFrame(() => {
    const mat = lineObj.material as THREE.LineBasicMaterial;
    const targetOpacity = isActive ? 0.55 : 0.12;
    mat.opacity += (targetOpacity - mat.opacity) * 0.08;
    mat.color.set(isActive ? color : "#8a7355");
  });

  return (
    <group>
      <primitive ref={lineRef} object={lineObj} />
      <DataPacket start={start} end={end} speed={isActive ? 0.55 : 0.2} color={isActive ? color : "#8a7355"} />
    </group>
  );
}

function SwarmScene({
  activeAgent,
  setActiveAgent,
}: {
  activeAgent: string | null;
  setActiveAgent: (name: string | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);

  const agents = [
    { name: "The Veteran", emoji: "🏛️", pos: [-2.5, 1.3, 0] as [number, number, number], color: "#8d98a6" },
    { name: "The Scaler", emoji: "🚀", pos: [2.5, 1.3, 0] as [number, number, number], color: "#6a8c7b" },
    { name: "The Mad Scientist", emoji: "🧪", pos: [2.5, -1.3, 0] as [number, number, number], color: "#d4a373" },
    { name: "The Pioneer", emoji: "⚡", pos: [-2.5, -1.3, 0] as [number, number, number], color: "#c98276" },
    { name: "The Judge", emoji: "⚖️", pos: [0, 0, 0.4] as [number, number, number], color: "#9c8a77", isJudge: true },
  ];

  const connections = [
    { from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 0 },
    { from: 0, to: 4 }, { from: 1, to: 4 }, { from: 2, to: 4 }, { from: 3, to: 4 },
  ];

  useFrame((state) => {
    if (groupRef.current) {
      // Gentle floating spin of the entire system
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.04;
      groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.02) * 0.05;
    }
  });

  return (
    <group ref={groupRef}>
      {connections.map((conn, i) => {
        const a = agents[conn.from];
        const b = agents[conn.to];
        const isActive = activeAgent === a.name || activeAgent === b.name;
        return (
          <ConnectionLine
            key={i}
            start={a.pos}
            end={b.pos}
            isActive={isActive}
            color={isActive ? (activeAgent === a.name ? a.color : b.color) : "#8a7355"}
          />
        );
      })}

      {agents.map((agent) => (
        <AgentOrb
          key={agent.name}
          position={agent.pos}
          color={agent.color}
          emoji={agent.emoji}
          name={agent.name}
          isActive={activeAgent === agent.name}
          isJudge={agent.isJudge}
          onClick={() => setActiveAgent(activeAgent === agent.name ? null : agent.name)}
        />
      ))}
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Framer Motion Variants
   ═══════════════════════════════════════════════════════════════════════ */

const messageVariants = {
  hidden: { opacity: 0, x: -16, scale: 0.98 },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 280, damping: 26 },
  },
  exit: { opacity: 0, x: -10, transition: { duration: 0.15 } },
};

const logVariants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.22 } },
};

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.25 } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

const cardPopVariants = {
  hidden: { opacity: 0, scale: 0.92, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 250, damping: 22 },
  },
  exit: { opacity: 0, scale: 0.95, y: 10, transition: { duration: 0.15 } },
};

/* ═══════════════════════════════════════════════════════════════════════
   Main React Component
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

  // Mid-debate interjection state
  const [interjectionQuestion, setInterjectionQuestion] = useState("");
  const [interjectionAnswer, setInterjectionAnswer] = useState("");
  const [interjectionSubmitting, setInterjectionSubmitting] = useState(false);

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
    setInterjectionQuestion("");
    setInterjectionAnswer("");

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

          if (msg.type === "interjection") {
            setPhase("waiting_for_mid_debate_input");
            setInterjectionQuestion(msg.question);
            setActiveAgent("The Judge");
            return;
          }

          if (msg.type === "status") {
            if (msg.status === "debating") {
              setPhase("debating");
              setInterjectionQuestion("");
              setInterjectionAnswer("");
              return;
            }

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

  const handleInterjectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!interjectionAnswer.trim() || !sessionId) return;

    setInterjectionSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/api/debate/interject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          user_answer: interjectionAnswer,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to submit interjection: ${res.statusText}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setInterjectionSubmitting(false);
    }
  };

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
    setUserAlignmentResponse("");
    setError(null);
    setInterjectionQuestion("");
    setInterjectionAnswer("");
  }, []);

  const getAgentClass = (name: string): string => {
    return AGENT_CLASS_MAP[name] || "judge";
  };

  const getCurrentRound = (): number => {
    const debateMessages = messages.filter((m) => m.round_number >= 0 && m.round_number <= 3);
    if (debateMessages.length === 0) return 0;
    return Math.max(...debateMessages.map((m) => m.round_number));
  };

  const getMessageLabel = (roundNumber: number): string => {
    if (roundNumber === 0) return "Initial Proposal";
    if (roundNumber >= 200 && roundNumber < 300) return "⚖️ Judge Question";
    if (roundNumber >= 300) return "💬 Your Answer";
    if (roundNumber === 99) return "Synthesis";
    if (roundNumber === 100) return "Final Verdict";
    if (roundNumber === 101) return "Alignment";
    if (roundNumber === 102) return "Your Response";
    return `Round ${roundNumber}`;
  };

  const isInterjectionMessage = (roundNumber: number): boolean => {
    return roundNumber >= 200 && roundNumber < 400;
  };

  const getStepState = (stepPhases: AppPhase[]): "complete" | "active" | "pending" => {
    if (stepPhases.includes(phase)) return "active";
    const phaseOrder: AppPhase[] = [
      "input",
      "debating",
      "waiting_for_mid_debate_input",
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
      {/* Fullscreen 3D Swarm Backdrop */}
      <div className="fullscreen-canvas-container">
        <Suspense fallback={null}>
          <Canvas
            camera={{ position: [0, 0, 7.8], fov: 45 }}
            style={{ background: "transparent" }}
            dpr={[1, 2]}
          >
            <ambientLight intensity={0.65} color="#fffcf0" />
            <directionalLight position={[10, 15, 10]} intensity={1.5} color="#fffaf0" />
            <pointLight position={[-10, -15, -10]} intensity={0.5} color="#e0f2fe" />
            <SwarmScene activeAgent={activeAgent} setActiveAgent={setActiveAgent} />
            <OrbitControls enableZoom={true} enablePan={false} maxDistance={12} minDistance={4} />
          </Canvas>
        </Suspense>
      </div>

      {/* Header */}
      <header className="header">
        <div className="header__logo">
          <span className="header__icon">🏛️</span>
          <h1 className="header__title">Agent Swarm</h1>
        </div>
        <p className="header__subtitle">
          Four expert agents debate project choices in a structured council, refined by the Judge.
        </p>
      </header>

      {/* Step Indicators */}
      <div className="steps">
        <StepIndicator number={1} label="Requirements" state={getStepState(["input"])} />
        <div className={`step__connector ${getStepState(["input"]) === "complete" ? "step__connector--active" : ""}`} />
        <StepIndicator number={2} label="Council Debate" state={getStepState(["debating", "waiting_for_mid_debate_input"])} />
        <div className={`step__connector ${getStepState(["debating"]) === "complete" ? "step__connector--active" : ""}`} />
        <StepIndicator number={3} label="Your Priorities" state={getStepState(["alignment_chat", "awaiting_priorities"])} />
        <div className={`step__connector ${getStepState(["awaiting_priorities"]) === "complete" ? "step__connector--active" : ""}`} />
        <StepIndicator number={4} label="Final Verdict" state={getStepState(["finalizing", "complete"])} />
      </div>

      {/* Error Display */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="status-bar"
            style={{ borderColor: "var(--accent-tertiary)", margin: "0 0 1rem" }}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <div className="status-bar__dot status-bar__dot--error" />
            <span className="status-bar__text">Error: {error}</span>
            <button className="btn btn--ghost" onClick={resetAll}>Reset</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Phase 1: Input Section */}
      <AnimatePresence>
        {phase === "input" && (
          <motion.div
            className="input-section glass-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
          >
            <label className="input-section__label" htmlFor="requirements-input">📋 Project Requirements & Goals</label>
            <textarea
              id="requirements-input"
              className="input-section__textarea"
              placeholder={`Describe your project. For example:\n\n"I want to build a real-time collaborative document editor like Notion, supporting up to 10,000 concurrent users. It needs rich text editing, commenting, version history, and real-time cursors. We have a team of 3 full-stack developers with experience in React and Python."`}
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

            {/* API Settings Panel */}
            <AnimatePresence>
              {showSettings && (
                <motion.div
                  className="settings-panel"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <h3 className="settings-panel__title">🔑 API Settings</h3>
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
                      <label className="settings-field__label">API Key (optional)</label>
                      <input
                        type="password"
                        className="settings-field__input"
                        value={settings.api_key}
                        onChange={(e) => setSettings({ ...settings, api_key: e.target.value })}
                        placeholder="sk-..."
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Split Dashboard (Phase 2 & onwards) */}
      {phase !== "input" && (
        <div className="swarm-dashboard">
          {/* Left Side: Activity Logs */}
          <div className="swarm-dashboard__left">
            <div className="activity-log">
              <div className="activity-log__header">
                <h3 className="activity-log__title">⚡ Swarm Activity Logs</h3>
              </div>
              <div className="activity-log__stream">
                {thinkingUpdates.length === 0 ? (
                  <div className="activity-log__empty">
                    <div className="loading-dots">
                      <span />
                      <span />
                      <span />
                    </div>
                    <p>Bootstrapping Agent Swarm...</p>
                  </div>
                ) : (
                  <AnimatePresence initial={false}>
                    {thinkingUpdates.map((update, idx) => (
                      <motion.div
                        key={idx}
                        className="log-item"
                        variants={logVariants}
                        initial="hidden"
                        animate="visible"
                      >
                        <span className="log-item__time">[{update.timestamp || ""}]</span>
                        <span className="log-item__emoji">{update.agent_emoji}</span>
                        <span className="log-item__text">
                          <strong>{update.agent_name}</strong>: {update.status_text}
                        </span>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>

          {/* Right Side: Council Debate Feed */}
          <div className="swarm-dashboard__main">
            <div className="debate-feed">
              <div className="debate-feed__header">
                <span className="debate-feed__title">🏛️ Council Debate Feed</span>
                {(phase === "debating" || phase === "waiting_for_mid_debate_input") && (
                  <div className="debate-feed__badge">
                    <div className="loading-dots" style={{ marginRight: 6 }}>
                      <span />
                      <span />
                      <span />
                    </div>
                    Round {getCurrentRound() || 1}
                  </div>
                )}
                {phase !== "debating" && phase !== "waiting_for_mid_debate_input" && messages.length > 0 && (
                  <div className="debate-feed__badge">✅ Complete</div>
                )}
              </div>

              {phase === "debating" && (
                <div className="status-bar">
                  <div className="status-bar__dot status-bar__dot--active" />
                  <span className="status-bar__text">
                    Swarm actively debating ({messages.filter((m) => m.round_number <= 3).length} messages)
                  </span>
                </div>
              )}

              <div className="debate-feed__scroll">
                <AnimatePresence initial={false}>
                  {messages
                    .filter((m) => m.round_number !== 99 && m.round_number !== 100)
                    .map((msg, idx) => {
                      const isExpanded = !!expandedMessages[idx];
                      const summary = getSummary(msg.content);
                      const showToggle = msg.content.length > 160;
                      const isInterject = isInterjectionMessage(msg.round_number);

                      return (
                        <motion.div
                          key={idx}
                          className={`agent-message agent-message--${isInterject ? "interjection" : getAgentClass(msg.agent_name)}`}
                          variants={messageVariants}
                          initial="hidden"
                          animate="visible"
                          layout
                        >
                          <div className="agent-message__header">
                            <div className="agent-message__avatar">{msg.agent_emoji}</div>
                            <div className="agent-message__info">
                              <div className="agent-message__name">{msg.agent_name}</div>
                              <div className="agent-message__title">{msg.agent_title}</div>
                            </div>
                            <div className="agent-message__round">
                              {getMessageLabel(msg.round_number)}
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
                                {isExpanded ? "Collapse ▲" : "Show full analysis ▼"}
                              </button>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                </AnimatePresence>

                {phase === "debating" && (
                  <div className="loading-indicator">
                    <div className="loading-dots">
                      <span />
                      <span />
                      <span />
                    </div>
                    <span>Agents computing...</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mid-Debate Interjection Dialog Overlay */}
      <AnimatePresence>
        {phase === "waiting_for_mid_debate_input" && interjectionQuestion && (
          <motion.div
            className="interjection-overlay"
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <motion.div
              className="interjection-card"
              variants={cardPopVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <div className="interjection-card__emoji">⚖️</div>
              <div className="interjection-card__title">The Judge Queries Your Preferences</div>
              <div className="interjection-card__question">{interjectionQuestion}</div>
              <form className="interjection-card__form" onSubmit={handleInterjectionSubmit}>
                <input
                  className="interjection-card__input"
                  type="text"
                  placeholder="Provide your input to direct the swarm..."
                  value={interjectionAnswer}
                  onChange={(e) => setInterjectionAnswer(e.target.value)}
                  disabled={interjectionSubmitting}
                  autoFocus
                />
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={interjectionSubmitting || !interjectionAnswer.trim()}
                >
                  {interjectionSubmitting ? "Sending..." : "Submit Answers"}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Judge Synthesis Section */}
      {judgeSynthesis && phase !== "input" && (
        <motion.div
          className="architecture-section"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
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
        </motion.div>
      )}

      {/* Phase 3: Conversational Alignment Chat */}
      {phase === "alignment_chat" && (
        <motion.div
          className="alignment-section glass-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
        >
          <h2 className="priorities-section__title">⚖️ Clarify Priorities with the Judge</h2>
          <p className="priorities-section__subtitle">
            The Judge has initiated a conversational alignment session to resolve key trade-offs.
          </p>

          <form onSubmit={handleAlignmentSubmit} style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
            <input
              type="text"
              className="interjection-card__input"
              style={{ flex: 1, height: "45px" }}
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
              {alignmentSubmitting ? "Sending..." : "Send Clarification"}
            </button>
          </form>
        </motion.div>
      )}

      {/* Finalizing Optimizer State */}
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

      {/* Phase 4: Final Verdict Output */}
      {phase === "complete" && finalVerdict && (
        <motion.div
          className="final-verdict"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
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
        </motion.div>
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
