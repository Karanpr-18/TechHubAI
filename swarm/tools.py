"""
Agent Tools Module
===================
DuckDuckGo search and Crawl4AI web scraping tools for the council agents.
Includes Groq-powered pre-summarization to reduce token usage.
"""

import asyncio
from typing import Optional
from swarm.config import SwarmConfig
from agentscope.agent import Agent
from agentscope.message import UserMsg


# ─── DuckDuckGo Search ───────────────────────────────────────────────────────

async def search_web(query: str, max_results: int = 5) -> list[dict]:
    """
    Search the web using DuckDuckGo. Returns a list of search results.

    Args:
        query: The search query string.
        max_results: Maximum number of results to return.

    Returns:
        List of dicts with 'title', 'url', 'snippet' keys.
    """
    from duckduckgo_search import DDGS

    results = []
    try:
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                results.append({
                    "title": r.get("title", ""),
                    "url": r.get("href", ""),
                    "snippet": r.get("body", ""),
                })
    except Exception as e:
        results.append({
            "title": "Search Error",
            "url": "",
            "snippet": f"Failed to search: {str(e)}",
        })

    return results


# ─── Crawl4AI Web Scraping ────────────────────────────────────────────────────

async def crawl_page(url: str, max_chars: int = 15000) -> str:
    """
    Crawl a webpage and extract its content as clean markdown using Crawl4AI.

    Args:
        url: The URL to crawl.
        max_chars: Maximum characters to return (to prevent context overload).

    Returns:
        Extracted markdown content from the page.
    """
    try:
        from crawl4ai import AsyncWebCrawler

        async with AsyncWebCrawler() as crawler:
            result = await crawler.arun(url=url)
            if result and result.markdown:
                return result.markdown[:max_chars]
            return f"Failed to extract content from {url}"
    except Exception as e:
        return f"Error crawling {url}: {str(e)}"


# ─── Pre-summarization (Token Optimization) ──────────────────────────────────

async def summarize_for_context(
    raw_content: str,
    context_query: str,
    config: SwarmConfig,
    token_callback = None,
) -> str:
    """
    Use the fast Groq-powered Llama-3-70B summarizer to extract only the
    architecturally relevant information from raw scraped content.

    This is the primary token reduction strategy: instead of feeding 4,000
    tokens of raw HTML/markdown into the debate agent's context, we extract
    the key facts into ~300-500 tokens.

    Args:
        raw_content: The raw scraped content from crawl4ai.
        context_query: What the agent was looking for (to guide extraction).
        config: Swarm configuration containing summarizer LLM settings.
        token_callback: Optional callback to receive token usage.

    Returns:
        A concise summary of the architecturally relevant facts.
    """
    system_prompt = (
        "You are a technical research assistant. Your job is to extract ONLY the "
        "architecturally relevant information from the given documentation. Focus on:\n"
        "- Key features and capabilities\n"
        "- Performance characteristics and benchmarks\n"
        "- Known limitations and constraints\n"
        "- Supported integrations and ecosystem\n"
        "- Maturity level and community adoption\n\n"
        "Output a concise bullet-point summary. NO marketing fluff. "
        "Maximum 400 words."
    )

    user_prompt = (
        f"RESEARCH QUERY: {context_query}\n\n"
        f"RAW DOCUMENTATION:\n{raw_content[:8000]}\n\n"
        "Extract the architecturally relevant facts as concise bullet points."
    )

    agent_model = config.summarizer_llm.get_agentscope_model()
    as_agent = Agent(name="Summarizer", system_prompt=system_prompt, model=agent_model)
    user_msg = UserMsg(name="System", content=user_prompt)
    reply_msg = await as_agent.reply(user_msg)
    if token_callback and hasattr(reply_msg, "usage") and reply_msg.usage:
        token_callback(reply_msg.usage)
    summary = str(reply_msg.content)

    return summary


# ─── Combined Research Tool ──────────────────────────────────────────────────

async def research_technology(
    query: str,
    config: SwarmConfig,
    max_search_results: int = 3,
    crawl_top_n: int = 1,
    token_callback = None,
) -> str:
    """
    Full research pipeline: Search → Crawl → Summarize.
    This is the tool the agents will use during the debate.

    Args:
        query: What the agent wants to research (e.g., "SurrealDB performance benchmarks").
        config: Swarm configuration.
        max_search_results: Number of search results to fetch.
        crawl_top_n: Number of top results to crawl for deep reading.
        token_callback: Optional callback to receive token usage.

    Returns:
        A concise, pre-summarized research report.
    """
    # Step 1: Search
    search_results = await search_web(query, max_results=max_search_results)

    if not search_results:
        return f"No search results found for: {query}"

    # Step 2: Build snippets summary
    snippets = "\n".join(
        f"- [{r['title']}]({r['url']}): {r['snippet']}"
        for r in search_results
    )

    # Step 3: Crawl top results for deeper context
    crawled_content = ""
    urls_to_crawl = [r["url"] for r in search_results[:crawl_top_n] if r["url"]]

    if urls_to_crawl:
        crawl_tasks = [crawl_page(url) for url in urls_to_crawl]
        crawl_results = await asyncio.gather(*crawl_tasks, return_exceptions=True)

        for url, result in zip(urls_to_crawl, crawl_results):
            if isinstance(result, str) and not result.startswith("Error"):
                crawled_content += f"\n\n--- Content from {url} ---\n{result}"

    # Step 4: Pre-summarize to reduce tokens
    combined_raw = f"SEARCH SNIPPETS:\n{snippets}\n\nDEEP CONTENT:\n{crawled_content}"

    if len(combined_raw) > 2000:
        # Only summarize if the content is large enough to warrant it
        summary = await summarize_for_context(combined_raw, query, config, token_callback)
        return f"**Research: {query}**\n{summary}"
    else:
        return f"**Research: {query}**\n{snippets}"


# ─── Semantic Cache ──────────────────────────────────────────────────────────

class ResearchCache:
    """
    Simple in-memory semantic cache for research results.
    If Agent A already researched "Next.js performance", Agent B won't
    re-crawl and re-summarize the same content.
    """

    def __init__(self):
        self._cache: dict[str, str] = {}

    def _normalize_key(self, query: str) -> str:
        """Normalize query for cache lookup."""
        return query.lower().strip()

    def get(self, query: str) -> Optional[str]:
        """Retrieve cached research result."""
        key = self._normalize_key(query)
        # Check for exact or near matches
        for cached_key, value in self._cache.items():
            if key in cached_key or cached_key in key:
                return value
        return None

    def set(self, query: str, result: str):
        """Cache a research result."""
        self._cache[self._normalize_key(query)] = result

    def clear(self):
        """Clear the cache."""
        self._cache.clear()


# Global cache instance
_research_cache = ResearchCache()


async def cached_research(
    query: str,
    config: SwarmConfig,
    max_search_results: int = 3,
    crawl_top_n: int = 1,
    token_callback = None,
) -> str:
    """
    Research with semantic caching. If a similar query was already researched,
    return the cached result instead of re-crawling.
    """
    cached = _research_cache.get(query)
    if cached:
        return f"[CACHED] {cached}"

    result = await research_technology(query, config, max_search_results, crawl_top_n, token_callback)
    _research_cache.set(query, result)
    return result
