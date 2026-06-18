"""
Debate Engine Module
=====================
Orchestrates the 3-round council debate using the LLM client and agent tools.
This is the core brain of TechHubAI.
"""

import asyncio
import json
from dataclasses import dataclass, field
from typing import Optional, AsyncIterator
from swarm.config import SwarmConfig
from agentscope.agent import Agent
from agentscope.message import UserMsg
from swarm.tools import cached_research, ResearchCache, _research_cache
from swarm.personas import (
    AgentPersona,
    ALL_COUNCIL_AGENTS,
    JUDGE_SYSTEM_PROMPT,
    JUDGE_FINAL_VERDICT_PROMPT,
)


# ─── Utility Functions ─────────────────────────────────────────────────────────

def extract_text(content) -> str:
    """Safely extract text from an AgentScope Msg content, which might be a string or a list of blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if hasattr(item, "text"):
                parts.append(item.text)
            elif isinstance(item, dict) and "text" in item:
                parts.append(item["text"])
            else:
                parts.append(str(item))
        return " ".join(parts)
    return str(content)

# ─── Data Models ─────────────────────────────────────────────────────────────

@dataclass
class DebateMessage:
    """A single message in the debate."""
    agent_name: str
    agent_emoji: str
    agent_title: str
    round_number: int
    content: str
    research_used: list[str] = field(default_factory=list)


@dataclass
class ThinkingUpdate:
    """A progress update during the swarm reasoning process."""
    agent_name: str
    agent_emoji: str
    status_text: str


@dataclass
class UserPriorities:
    """User's 1-10 ratings for different factors."""
    tech_difficulty: int = 5
    efficiency: int = 5
    latency: int = 5
    cost: int = 5
    maintainability: int = 5
    scalability: int = 5
    time_to_market: int = 5
    community_support: int = 5

    def to_text(self) -> str:
        """Convert priorities to a human-readable string for the Judge."""
        return (
            f"- Tech Stack Difficulty / Ease of Learning: {self.tech_difficulty}/10\n"
            f"- Efficiency / Performance: {self.efficiency}/10\n"
            f"- Latency Requirements: {self.latency}/10\n"
            f"- Operational Cost: {self.cost}/10\n"
            f"- Maintainability: {self.maintainability}/10\n"
            f"- Scalability: {self.scalability}/10\n"
            f"- Time to Market / Development Speed: {self.time_to_market}/10\n"
            f"- Community Support & Ecosystem: {self.community_support}/10\n"
        )


@dataclass
class DebateState:
    """The full state of a debate session."""
    project_requirements: str = ""
    messages: list[DebateMessage] = field(default_factory=list)
    thinking_updates: list[ThinkingUpdate] = field(default_factory=list)
    initial_proposals: dict[str, str] = field(default_factory=dict)
    judge_synthesis: str = ""
    user_priorities: Optional[UserPriorities] = None
    questionnaire: dict = field(default_factory=dict)
    alignment_history: list[dict] = field(default_factory=list)  # [{"role": "assistant"|"user", "content": "text"}]
    alignment_turns: int = 0
    final_verdict: str = ""
    status: str = "idle"  # idle, debating, waiting_for_mid_debate_input, alignment_chat, finalizing, complete
    # Mid-debate dynamic interjection support
    mid_debate_question: str = ""
    mid_debate_answer: str = ""
    mid_debate_answers: list[dict] = field(default_factory=list)  # [{"question": ..., "answer": ...}]
    user_interjection_event: Optional[asyncio.Event] = field(default=None)
    total_input_tokens: int = 0
    total_output_tokens: int = 0

    def get_debate_history(self, max_rounds: Optional[int] = None) -> str:
        """Get the formatted debate history for context."""
        messages = self.messages
        if max_rounds:
            messages = [m for m in messages if m.round_number <= max_rounds]

        history = ""
        for msg in messages:
            history += (
                f"\n### {msg.agent_emoji} {msg.agent_name} ({msg.agent_title}) "
                f"- Round {msg.round_number}\n"
                f"{msg.content}\n"
            )
        return history

    def get_compressed_history(self) -> str:
        """
        Get a compressed version of older debate rounds.
        Only the most recent round is kept in full; older rounds are summarized.
        This is the Context History Compression strategy.
        """
        if not self.messages:
            return ""

        max_round = max(m.round_number for m in self.messages)

        # Keep the most recent round in full
        recent = [m for m in self.messages if m.round_number == max_round]

        # Summarize older rounds
        older = [m for m in self.messages if m.round_number < max_round]

        history = ""
        if older:
            history += "\n## Summary of Previous Rounds\n"
            for msg in older:
                # Keep only the first 250 chars of older messages to balance detail with token safety
                truncated = msg.content[:250] + ("..." if len(msg.content) > 250 else "")
                history += f"- **{msg.agent_name}** (Round {msg.round_number}): {truncated}\n"

        history += "\n## Current Round\n"
        for msg in recent:
            history += (
                f"\n### {msg.agent_emoji} {msg.agent_name} ({msg.agent_title})\n"
                f"{msg.content}\n"
            )

        return history

    def get_compressed_debate_history(self) -> str:
        """
        Get a compressed debate history for the Judge's synthesis.
        Rounds 0, 1, and 2 are summarized/truncated to prevent token overflow.
        The final round is kept in full.
        """
        if not self.messages:
            return ""

        valid_rounds = [m.round_number for m in self.messages if 0 <= m.round_number <= 3]
        max_round = max(valid_rounds) if valid_rounds else 0

        history = ""
        for msg in self.messages:
            if not (0 <= msg.round_number <= 3):
                continue  # Skip Judge synthesis, alignment, errors, and verdict messages
            
            # Format title
            title = f"\n### {msg.agent_emoji} {msg.agent_name} ({msg.agent_title}) - Round {msg.round_number}\n"
            
            # For the final round (usually round 3), keep in full
            if msg.round_number == max_round:
                history += title + f"{msg.content}\n"
            else:
                # For older rounds, truncate to 350 characters to stay within token limits
                truncated = msg.content[:350]
                if len(msg.content) > 350:
                    truncated += "..."
                history += title + f"{truncated}\n"
                
        return history


# ─── Debate Engine ────────────────────────────────────────────────────────────

class DebateEngine:
    """
    Orchestrates the full council debate workflow:
    1. Initial proposals from all 4 agents
    2. 3 rounds of debate
    3. Judge synthesis
    4. User priority input
    5. Final verdict
    """

    def __init__(self, config: SwarmConfig):
        self.config = config
        self.state = DebateState()
        self._callbacks: list = []

    def on_message(self, callback):
        """Register a callback to be called when a new message is added."""
        self._callbacks.append(callback)

    async def _notify(self, message: DebateMessage):
        """Notify all registered callbacks of a new message."""
        for cb in self._callbacks:
            if asyncio.iscoroutinefunction(cb):
                await cb(message)
            else:
                cb(message)

    def add_thinking_update(self, agent_name: str, agent_emoji: str, status_text: str):
        """Append a status update to the thinking timeline."""
        update = ThinkingUpdate(agent_name=agent_name, agent_emoji=agent_emoji, status_text=status_text)
        self.state.thinking_updates.append(update)
        print(f"[{agent_name}] {status_text}")

    def _accumulate_token_usage(self, reply_msg):
        if hasattr(reply_msg, "usage") and reply_msg.usage is not None:
            self._accumulate_token_usage_obj(reply_msg.usage)

    def _accumulate_token_usage_obj(self, usage):
        if usage is not None:
            input_tokens = getattr(usage, "input_tokens", 0) or 0
            output_tokens = getattr(usage, "output_tokens", 0) or 0
            self.state.total_input_tokens += input_tokens
            self.state.total_output_tokens += output_tokens
            print(f"Accumulated tokens: input={input_tokens}, output={output_tokens}, total={self.state.total_input_tokens + self.state.total_output_tokens}")

    # ─── Phase 1: Initial Proposals ──────────────────────────────────────

    async def generate_initial_proposals(self, project_requirements: str) -> dict[str, str]:
        """
        All 4 agents independently research and propose their ideal tech stack.
        """
        self.state.project_requirements = project_requirements
        self.state.status = "debating"
        self.add_thinking_update("System", "🤖", "Council is gathering project requirements...")

        # Detect domain and get addons
        search_suffix, prompt_instruction = classify_and_augment_domain(project_requirements)
        if search_suffix:
            self.add_thinking_update("System", "🤖", "Detected domain characteristics. Augmenting search parameters...")

        # Clear the research cache for a fresh session
        _research_cache.clear()

        async def _generate_proposal(agent: AgentPersona) -> tuple[str, str]:
            # First, let the agent do some research
            self.add_thinking_update(agent.name, agent.emoji, f"Searching for technologies related to {agent.search_guidance[:50]}...")
            research_results = await cached_research(
                query=f"{agent.search_guidance}{search_suffix} for: {project_requirements[:200]}",
                config=self.config,
                token_callback=self._accumulate_token_usage_obj,
            )

            self.add_thinking_update(agent.name, agent.emoji, f"Formulating initial proposal stack based on research...")
            user_prompt = (
                f"## Project Requirements\n{project_requirements}\n\n"
                f"## Your Research Findings\n{research_results}\n\n"
                "Based on these requirements and your research, propose your IDEAL "
                "tech stack and architecture. Be specific about:\n"
                "1. Frontend framework and approach\n"
                "2. Backend language and framework\n"
                "3. Database(s)\n"
                "4. Deployment and infrastructure\n"
                "5. Key supporting tools and services\n\n"
                f"{prompt_instruction}\n\n"
                "Argue passionately from YOUR perspective. Maximum 300 words."
            )

            agent_model = self.config.primary_llm.get_agentscope_model()
            as_agent = Agent(name=agent.name, system_prompt=agent.system_prompt, model=agent_model)
            user_msg = UserMsg(name="System", content=user_prompt)
            
            reply_msg = await as_agent.reply(user_msg)
            self._accumulate_token_usage(reply_msg)
            response = extract_text(reply_msg.content)

            # Create and store the message
            msg = DebateMessage(
                agent_name=agent.name,
                agent_emoji=agent.emoji,
                agent_title=agent.title,
                round_number=0,
                content=response,
                research_used=[research_results[:200]],
            )
            self.state.messages.append(msg)
            self.add_thinking_update(agent.name, agent.emoji, "Published initial stack proposal.")
            await self._notify(msg)

            return agent.name, response

        # Run all 4 proposals in parallel
        tasks = [_generate_proposal(agent) for agent in ALL_COUNCIL_AGENTS]
        results = await asyncio.gather(*tasks)

        self.state.initial_proposals = dict(results)
        return self.state.initial_proposals

    # ─── Phase 2: Debate Rounds ──────────────────────────────────────────

    async def run_debate_round(self, round_number: int) -> list[DebateMessage]:
        """
        Run a single round of the debate where agents respond to each other.
        """
        round_messages = []
        search_suffix, prompt_instruction = classify_and_augment_domain(self.state.project_requirements)

        for agent in ALL_COUNCIL_AGENTS:
            self.add_thinking_update(agent.name, agent.emoji, f"Preparing arguments for Round {round_number}...")
            # Get the debate context (compressed for older rounds)
            if round_number <= 1:
                context = self.state.get_debate_history()
            else:
                context = self.state.get_compressed_history()

            # Optionally do follow-up research
            research_context = ""
            if round_number >= 2:
                # In later rounds, agents can do targeted research to back up claims
                other_agents_points = "\n".join(
                    f"- {m.agent_name}: {m.content[:150]}"
                    for m in self.state.messages
                    if m.agent_name != agent.name and m.round_number == round_number - 1
                )
                if other_agents_points:
                    research_query = (
                        f"counter-arguments and evidence for {agent.search_guidance}{search_suffix}: "
                        f"{other_agents_points[:200]}"
                    )
                    self.add_thinking_update(agent.name, agent.emoji, f"Running targeted search: {research_query[:50]}...")
                    research_context = await cached_research(
                        query=research_query,
                        config=self.config,
                        max_search_results=2,
                        crawl_top_n=1,
                        token_callback=self._accumulate_token_usage_obj,
                    )

            round_prompts = {
                1: (
                    "ROUND 1 - INITIAL PITCH\n"
                    "Present your proposed architecture and tech stack based on your research. "
                    "Be bold and argue passionately from your perspective."
                ),
                2: (
                    "ROUND 2 - CRITIQUE\n"
                    "Review the other agents' proposals and critique them. "
                    "Point out flaws, risks, and hidden costs in their approaches. "
                    "Defend your own position with evidence."
                ),
                3: (
                    "ROUND 3 - REBUTTAL & COMPROMISE\n"
                    "This is the final round. Defend your position against critiques, "
                    "but also acknowledge valid points from others. "
                    "Propose compromises where your tech can work alongside others. "
                    "Be constructive."
                ),
            }

            round_instruction = round_prompts.get(
                round_number,
                f"ROUND {round_number} - Continue the debate."
            )

            self.add_thinking_update(agent.name, agent.emoji, f"Drafting critique and tech recommendations for Round {round_number}...")
            user_prompt = (
                f"## Project Requirements\n{self.state.project_requirements}\n\n"
                f"## Debate History\n{context}\n\n"
            )

            if research_context:
                user_prompt += f"## Your Follow-up Research\n{research_context}\n\n"

            # Inject mid-debate user clarifications if available
            if self.state.mid_debate_answers:
                clarifications = "\n".join(
                    f"Q: {qa['question']}\nA: {qa['answer']}"
                    for qa in self.state.mid_debate_answers
                )
                user_prompt += f"## User Clarifications (Mid-Debate)\n{clarifications}\n\n"

            user_prompt += (
                f"## Your Task\n{round_instruction}\n\n"
                f"{prompt_instruction}\n\n"
                "Keep your response focused and under 250 words. "
                "Be specific about technology choices."
            )

            agent_model = self.config.primary_llm.get_agentscope_model()
            as_agent = Agent(name=agent.name, system_prompt=agent.system_prompt, model=agent_model)
            user_msg = UserMsg(name="System", content=user_prompt)
            
            reply_msg = await as_agent.reply(user_msg)
            self._accumulate_token_usage(reply_msg)
            response = extract_text(reply_msg.content)

            msg = DebateMessage(
                agent_name=agent.name,
                agent_emoji=agent.emoji,
                agent_title=agent.title,
                round_number=round_number,
                content=response,
                research_used=[research_context[:200]] if research_context else [],
            )
            self.state.messages.append(msg)
            self.add_thinking_update(agent.name, agent.emoji, f"Published Round {round_number} response.")
            round_messages.append(msg)
            await self._notify(msg)

        return round_messages

    async def run_full_debate(self) -> list[DebateMessage]:
        """Run all 3 rounds of the debate, with dynamic Judge interjections."""
        all_messages = []
        for round_num in range(1, self.config.debate_rounds + 1):
            round_msgs = await self.run_debate_round(round_num)
            all_messages.extend(round_msgs)

            # After each round, let the Judge dynamically evaluate if a question is needed
            if round_num < self.config.debate_rounds:
                should_ask = await self._judge_evaluate_interjection(round_num)
                if should_ask:
                    # Pause and wait for user answer
                    await self._pause_for_user_interjection()
        return all_messages

    async def _judge_evaluate_interjection(self, round_number: int) -> bool:
        """
        After a debate round, the Judge silently evaluates whether there is
        a critical ambiguity that needs user input before proceeding.
        Returns True if a question was generated and the debate should pause.
        """
        self.add_thinking_update("The Judge", "⚖️", f"Evaluating debate progress after Round {round_number}...")

        debate_so_far = self.state.get_compressed_history()
        prev_answers = ""
        if self.state.mid_debate_answers:
            prev_answers = "\n## Previous User Clarifications\n"
            for qa in self.state.mid_debate_answers:
                prev_answers += f"Q: {qa['question']}\nA: {qa['answer']}\n\n"

        system_prompt = (
            "You are the Technical Judge overseeing a council debate about a tech stack.\n"
            "After reviewing the latest round of debate, decide if there is a CRITICAL ambiguity "
            "in the user's project requirements that, if left unresolved, would lead the agents "
            "to make fundamentally wrong assumptions in the next round.\n\n"
            "Rules:\n"
            "- Only ask if there is a genuinely CRITICAL gap. Do NOT ask trivial or nice-to-have questions.\n"
            "- If you already have enough context, output EXACTLY the word: CONTINUE\n"
            "- If you need to ask, output a single, friendly, direct question (max 40 words). "
            "Do NOT output multiple questions. Do NOT use bullet points.\n"
            "- Do NOT repeat questions that were already answered.\n\n"
            "Output ONLY one of:\n"
            "1. The word CONTINUE\n"
            "2. Your single clarification question"
        )

        user_prompt = (
            f"## Project Requirements\n{self.state.project_requirements}\n\n"
            f"## Debate So Far (Round {round_number} just completed)\n{debate_so_far}\n\n"
            f"{prev_answers}"
            "Should the debate continue, or is there a critical ambiguity you need the user to clarify?"
        )

        agent_model = self.config.primary_llm.get_agentscope_model()
        as_agent = Agent(name="The Judge", system_prompt=system_prompt, model=agent_model)
        user_msg = UserMsg(name="System", content=user_prompt)
        
        reply_msg = await as_agent.reply(user_msg)
        self._accumulate_token_usage(reply_msg)
        response = extract_text(reply_msg.content)

        cleaned = response.strip()
        if cleaned.upper() == "CONTINUE" or len(cleaned) < 5:
            self.add_thinking_update("The Judge", "⚖️", "No critical ambiguities detected. Debate continues.")
            return False

        # The Judge has a question!
        self.state.mid_debate_question = cleaned
        self.add_thinking_update("The Judge", "⚖️", f"Critical question identified: {cleaned[:80]}...")

        # Emit the question as a debate message
        msg = DebateMessage(
            agent_name="The Judge",
            agent_emoji="⚖️",
            agent_title="Mid-Debate Clarification",
            round_number=200 + round_number,  # Special round number for mid-debate questions
            content=cleaned,
        )
        self.state.messages.append(msg)
        await self._notify(msg)
        return True

    async def _pause_for_user_interjection(self):
        """Pause the debate loop and wait for the user to answer the Judge's question."""
        self.state.user_interjection_event = asyncio.Event()
        self.state.status = "waiting_for_mid_debate_input"
        self.add_thinking_update("System", "⏸️", "Debate paused. Waiting for user clarification...")

        # Block until the event is set by the /api/debate/interject endpoint
        await self.state.user_interjection_event.wait()

        # Resume
        self.state.status = "debating"
        self.add_thinking_update("System", "▶️", "User responded. Resuming debate...")

    # ─── Phase 3: Judge Synthesis ────────────────────────────────────────

    async def judge_synthesize(self) -> str:
        """
        The Judge reviews the entire debate and synthesizes 2-3 hybrid architectures.
        """
        self.state.status = "awaiting_priorities"
        self.add_thinking_update("The Judge", "⚖️", "Reviewing transcripts and comparing council agents' arguments...")

        full_debate = self.state.get_compressed_debate_history()
        _, prompt_instruction = classify_and_augment_domain(self.state.project_requirements)

        user_prompt = (
            f"## Project Requirements\n{self.state.project_requirements}\n\n"
            f"## Full Council Debate\n{full_debate}\n\n"
            "## Your Task\n"
            "Synthesize the debate into 2-3 distinct hybrid architectures. "
            "Each architecture should combine the best ideas from the agents. "
            "Include Mermaid.js diagrams for each option. "
            "Rank them and explain the trade-offs.\n"
            f"{prompt_instruction}"
        )

        self.add_thinking_update("The Judge", "⚖️", "Synthesizing hybrid architectures & generating Mermaid diagrams...")
        
        agent_model = self.config.primary_llm.get_agentscope_model()
        as_agent = Agent(name="The Judge", system_prompt=JUDGE_SYSTEM_PROMPT, model=agent_model)
        user_msg = UserMsg(name="System", content=user_prompt)
        
        reply_msg = await as_agent.reply(user_msg)
        self._accumulate_token_usage(reply_msg)
        self.state.judge_synthesis = extract_text(reply_msg.content)

        # Notify via a Judge message
        msg = DebateMessage(
            agent_name="The Judge",
            agent_emoji="⚖️",
            agent_title="The Synthesizer",
            round_number=99,
            content=self.state.judge_synthesis,
        )
        self.add_thinking_update("The Judge", "⚖️", "Synthesis complete. Starting conversational alignment...")
        await self._notify(msg)

        return self.state.judge_synthesis

    # ─── Phase 3.5: Conversational Alignment Chat ───────────────────────

    async def start_alignment(self) -> str:
        """
        Starts the conversational alignment phase. The Judge reviews the debate
        and requirements, then generates the FIRST targeted clarification question.
        """
        self.state.status = "alignment_chat"
        self.state.alignment_turns = 1
        self.state.alignment_history = []
        self.add_thinking_update("The Judge", "⚖️", "Analyzing project trade-offs to spot remaining ambiguities...")

        system_prompt = (
            "You are the Technical Judge. The council agents have finished debating.\n"
            "You have synthesized the architectures, but there is still a key trade-off or ambiguity in the requirements.\n\n"
            "Your task:\n"
            "Identify the SINGLE most critical trade-off or conflict (e.g., development speed vs performance, or cost vs scale).\n"
            "Formulate a single, friendly, direct, and conversational question (max 35 words) to ask the user to clarify this trade-off.\n"
            "CRITICAL: Do NOT list multiple questions. Do NOT ask multiple questions. Do NOT use bullet points or lists. Ask exactly ONE single question. "
            "Example: 'To help me finalize, since you mentioned a very small team but need high performance, would you prefer a simple PostgreSQL setup to save dev time, or a custom-tuned Go/Redis setup?'"
        )

        user_prompt = (
            f"## Project Requirements\n{self.state.project_requirements}\n\n"
            f"## Debate Context\n{self.state.get_compressed_debate_history()}\n\n"
            "Determine the single most critical trade-off and ask your question."
        )

        self.add_thinking_update("The Judge", "⚖️", "Composing critical trade-off clarification question...")
        
        agent_model = self.config.primary_llm.get_agentscope_model()
        as_agent = Agent(name="The Judge", system_prompt=system_prompt, model=agent_model)
        user_msg = UserMsg(name="System", content=user_prompt)
        
        reply_msg = await as_agent.reply(user_msg)
        self._accumulate_token_usage(reply_msg)
        first_question = extract_text(reply_msg.content)

        # Store in history
        self.state.alignment_history.append({"role": "assistant", "content": first_question})
        
        # Append Judge message to messages stream for frontend UI tracking
        msg = DebateMessage(
            agent_name="The Judge",
            agent_emoji="⚖️",
            agent_title="Conversational Alignment",
            round_number=101,  # Special round number representing alignment chat
            content=first_question,
        )
        self.state.messages.append(msg)
        await self._notify(msg)

        return first_question

    async def process_alignment_turn(self, user_response: str) -> dict:
        """
        Processes a user response in the alignment chat.
        Evaluates their response, updates ratings, and either generates the next question or the final verdict.
        """
        self.add_thinking_update("The Judge", "⚖️", "Received user response. Evaluating alignment trade-offs...")
        # Store user response
        self.state.alignment_history.append({"role": "user", "content": user_response})
        
        # Append User message to messages stream for UI
        user_msg = DebateMessage(
            agent_name="User",
            agent_emoji="👤",
            agent_title="Clarification",
            round_number=102,  # Special round number representing user responses
            content=user_response,
        )
        self.state.messages.append(user_msg)
        await self._notify(user_msg)

        self.state.alignment_turns += 1

        # Format history for LLM
        formatted_history = ""
        for turn in self.state.alignment_history[:-1]:
            role_name = "Judge" if turn["role"] == "assistant" else "User"
            formatted_history += f"{role_name}: {turn['content']}\n"

        system_prompt = (
            "You are the Technical Judge in a conversational alignment chat with the user.\n"
            "Based on the conversation history and the latest user response, update your internal architectural ratings and decide whether to ask a follow-up question or stop and produce the final verdict.\n\n"
            "Your tasks:\n"
            "1. Evaluate and update the 1-10 importance rating for all 8 categories:\n"
            "   - tech_difficulty, efficiency, latency, cost, maintainability, scalability, time_to_market, community_support\n"
            "2. Decide if you need ONE more clarification question (decision = 'question') or if you have enough info to deliver the final verdict (decision = 'verdict').\n"
            "   - CRITICAL RULE: If the user says 'no', 'no thanks', 'I like it', 'looks good', or indicates they don't want any changes, you MUST immediately choose 'verdict'. Do not ask any more questions.\n"
            f"   - Note: This is turn {self.state.alignment_turns} of 3. If this is turn 3, you MUST choose 'verdict'.\n"
            "3. If decision is 'question', formulate the next single clarification question (max 35 words). Do NOT ask multiple questions. Do NOT use bullet points. Ask exactly ONE single question.\n\n"
            "Return ONLY a valid JSON object matching this schema:\n"
            "{\n"
            "  \"ratings\": {\n"
            "    \"tech_difficulty\": 5,\n"
            "    \"efficiency\": 5,\n"
            "    \"latency\": 5,\n"
            "    \"cost\": 5,\n"
            "    \"maintainability\": 5,\n"
            "    \"scalability\": 5,\n"
            "    \"time_to_market\": 5,\n"
            "    \"community_support\": 5\n"
            "  },\n"
            "  \"decision\": \"question\"|\"verdict\",\n"
            "  \"next_question\": \"Your next single clarification question\"\n"
            "}"
        )

        user_prompt = (
            f"## Project Requirements\n{self.state.project_requirements}\n\n"
            f"## Conversation History\n{formatted_history}\n\n"
            f"## User's Latest Response\n\"{user_response}\"\n\n"
            "Analyze and return the JSON object."
        )

        self.add_thinking_update("The Judge", "⚖️", "Recalculating score priorities and generating next step...")
        
        agent_model = self.config.primary_llm.get_agentscope_model()
        as_agent = Agent(name="The Judge", system_prompt=system_prompt, model=agent_model)
        user_msg = UserMsg(name="System", content=user_prompt)
        
        reply_msg = await as_agent.reply(user_msg)
        self._accumulate_token_usage(reply_msg)
        response_str = extract_text(reply_msg.content)

        cleaned = response_str.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

        try:
            data = json.loads(cleaned)
            ratings = data.get("ratings", {})
            decision = data.get("decision", "verdict")
            next_q = data.get("next_question", "")
        except Exception as e:
            print(f"⚠️ Failed to parse alignment JSON: {e}. Raw response: {response_str}")
            ratings = {k: 5 for k in ["tech_difficulty", "efficiency", "latency", "cost", "maintainability", "scalability", "time_to_market", "community_support"]}
            decision = "verdict"
            next_q = ""

        # Update questionnaire state with current ratings
        self.state.questionnaire = {
            k: {"status": "clear", "rating": v, "explanation": "Conversational alignment update", "question": ""}
            for k, v in ratings.items()
        }

        if decision == "question" and next_q:
            self.state.alignment_history.append({"role": "assistant", "content": next_q})
            # Append Judge message to stream
            msg = DebateMessage(
                agent_name="The Judge",
                agent_emoji="⚖️",
                agent_title="Conversational Alignment",
                round_number=101,
                content=next_q,
            )
            self.state.messages.append(msg)
            await self._notify(msg)
            return {"status": "alignment_chat", "next_question": next_q}
        else:
            # We are done! Generate the final verdict!
            priorities = UserPriorities(**ratings)
            final_v = await self.final_verdict(priorities)
            return {"status": "complete", "final_verdict": final_v}

    # ─── Phase 4: Final Verdict ──────────────────────────────────────────

    async def final_verdict(self, priorities: UserPriorities) -> str:
        """
        The Judge delivers the final verdict.
        """
        self.state.user_priorities = priorities
        self.state.status = "finalizing"
        self.add_thinking_update("The Judge", "🏆", "Preparing final recommendation verdict...")
        _, prompt_instruction = classify_and_augment_domain(self.state.project_requirements)

        # Format alignment conversation history for the prompt
        formatted_history = ""
        if self.state.alignment_history:
            for turn in self.state.alignment_history:
                role_name = "Judge" if turn["role"] == "assistant" else "User"
                formatted_history += f"{role_name}: {turn['content']}\n"

        user_prompt = (
            f"## Project Requirements\n{self.state.project_requirements}\n\n"
            f"## Synthesized Architectures\n{self.state.judge_synthesis}\n\n"
        )
        if formatted_history:
            user_prompt += f"## User Feedback / Alignment History\n{formatted_history}\n\n"

        user_prompt += (
            f"## User Priority Ratings (Blended)\n{priorities.to_text()}\n\n"
            "## Your Task\n"
            "Based on the user's feedback, alignment history, and priority ratings, select the BEST architecture "
            "and MODIFY the tech stack choices to optimally match their priorities and specific suggestions. "
            "For example, if they expressed a preference for a specific framework or tool, or rejected a proposal during the conversation, respect that feedback. "
            "If the user values cost (10/10) but latency is low (2/10), adjust accordingly. "
            "Provide the complete final recommendation with a Mermaid.js diagram.\n"
            f"{prompt_instruction}"
        )

        self.add_thinking_update("The Judge", "🏆", "Optimizing technical stack according to prioritized trade-offs...")
        
        agent_model = self.config.primary_llm.get_agentscope_model()
        as_agent = Agent(name="The Judge", system_prompt=JUDGE_FINAL_VERDICT_PROMPT, model=agent_model)
        user_msg = UserMsg(name="System", content=user_prompt)
        
        reply_msg = await as_agent.reply(user_msg)
        self._accumulate_token_usage(reply_msg)
        self.state.final_verdict = extract_text(reply_msg.content)

        self.state.status = "complete"

        # Notify via a Judge message
        msg = DebateMessage(
            agent_name="The Judge",
            agent_emoji="🏆",
            agent_title="Final Verdict",
            round_number=100,
            content=self.state.final_verdict,
        )
        self.add_thinking_update("The Judge", "🏆", "Final verdict published.")
        await self._notify(msg)

        return self.state.final_verdict

    # ─── Full Pipeline ───────────────────────────────────────────────────

    async def run_debate_pipeline(self, project_requirements: str) -> str:
        """
        Run the full debate pipeline up to judge synthesis.
        """
        # Phase 1: Initial proposals
        await self.generate_initial_proposals(project_requirements)

        # Phase 2: 3 rounds of debate
        await self.run_full_debate()

        # Phase 3: Judge synthesis
        synthesis = await self.judge_synthesize()

        # Phase 3.5: Conversational Alignment Chat
        await self.start_alignment()

        return synthesis


def classify_and_augment_domain(project_requirements: str) -> tuple[str, str]:
    """
    Analyzes project requirements for domain-specific keywords.
    Returns:
        1. A search query suffix (e.g. ' focusing on AI agents, RAG, vector databases')
        2. A prompt instruction to append to LLM prompts.
    """
    req_lower = project_requirements.lower()
    
    domains = {
        "ai": {
            "keywords": ["ai", "artificial intelligence", "agent", "agentic", "llm", "large language model", "gpt", "rag", "vector", "embeddings", "machine learning", "deep learning", "nlp"],
            "search_addon": "AI agents, LLM orchestrators, vector databases, RAG framework, ML inference",
            "prompt_addon": "propose specific AI orchestrators (e.g. LangGraph, CrewAI, AutoGen, LlamaIndex), vector databases (e.g. Qdrant, pgvector, Milvus), and model serving tools."
        },
        "blockchain": {
            "keywords": ["blockchain", "web3", "crypto", "nft", "smart contract", "ethereum", "solana", "dapp", "solidity", "decentralized"],
            "search_addon": "web3 SDKs, smart contract frameworks, node RPC provider, indexer",
            "prompt_addon": "propose smart contract environments (e.g. Hardhat, Foundry, Anchor), RPC providers (e.g. Alchemy, Infura), and Web3 integrations (e.g. ethers.js, viem)."
        },
        "iot": {
            "keywords": ["iot", "internet of things", "embedded", "firmware", "sensor", "mqtt", "hardware", "arduino", "raspberry pi", "esp32"],
            "search_addon": "IoT protocol broker, time-series database, embedded framework, IoT hub",
            "prompt_addon": "propose time-series data stores (e.g. InfluxDB, TimescaleDB), protocol brokers (e.g. EMQX, Mosquitto), and firmware runtimes."
        },
        "data_engineering": {
            "keywords": ["data pipeline", "etl", "elt", "data engineering", "analytics", "data warehouse", "big data", "spark", "kafka", "clickhouse", "snowflake"],
            "search_addon": "data warehouse, ETL orchestrator, stream processing, OLAP engine",
            "prompt_addon": "propose OLAP/Data warehouses (e.g. ClickHouse, Snowflake, DuckDB), stream processors (e.g. Kafka, Redpanda), and orchestrators (e.g. Airflow, Prefect, Dagster)."
        },
        "gaming": {
            "keywords": ["game", "gaming", "unreal", "unity", "godot", "multiplayer", "physics engine", "webgl", "webgpu", "canvas"],
            "search_addon": "game backend, real-time multiplayer server, WebGL/WebGPU framework",
            "prompt_addon": "propose game engines/renderers (e.g. Three.js, PixiJS, Bevy), multiplayer networking (e.g. Colyseus, Socket.io), and game state databases."
        }
    }
    
    active_search_addons = []
    active_prompt_addons = []
    
    for domain_name, config in domains.items():
        if any(keyword in req_lower for keyword in config["keywords"]):
            active_search_addons.append(config["search_addon"])
            active_prompt_addons.append(config["prompt_addon"])
            
    if active_search_addons:
        search_suffix = " focusing on " + ", ".join(active_search_addons)
        prompt_instruction = "\nSince this project involves domain-specific requirements, you MUST explicitly: " + "; ".join(active_prompt_addons)
        return search_suffix, prompt_instruction
        
    return "", ""
