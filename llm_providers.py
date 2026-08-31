"""LLM provider adapter layer — same idea as bookmakers.py: analysis.py only
talks to AnalysisProvider, switching the model that does the reasoning is a
config value change, not a rewrite.

Only Claude has *native* web search built into the API call. Free providers
(Groq) don't, so their adapter does its own DuckDuckGo pass and stuffs the
snippets into the prompt before asking the model to reason over them — that
research step is the entire point of this bot, so a free path that skipped
it would just be worse than doing nothing. Expect materially shallower
analysis from the free path regardless — a free model doing web-adjacent
reasoning is not the same as Opus 5 doing genuine multi-step research.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

SYSTEM_PROMPT = (
    "You are a sharp, disciplined football betting analyst. You are honest about "
    "uncertainty and would rather say 'skip' than force a pick with no real edge."
)


class AnalysisProvider(ABC):
    @abstractmethod
    def analyze(self, team_a: str, team_b: str, league_hint: str | None, user_prompt: str) -> str:
        """Runs the match-analysis prompt (already contains market/stats
        context) and returns the raw response text, expected to end in a
        fenced ```json block — analysis.py parses that part itself."""

    @abstractmethod
    def quick_answer(self, team_a: str, team_b: str, search_query: str, prompt: str) -> str:
        """A cheaper, narrower call for a single factual question (final
        score, late team news) — still grounded in search, but doesn't need
        the full match-analysis system prompt or effort level. Providers
        without native search use search_query verbatim against DuckDuckGo;
        Claude ignores it and searches on its own terms."""


class ClaudeProvider(AnalysisProvider):
    """Default. Opus 5 + native web_search + high effort — see analysis.py
    for why this is worth the (small, at low match volume) per-call cost."""

    MODEL = "claude-opus-5"
    EFFORT = "high"

    def __init__(self):
        from anthropic import Anthropic
        self.client = Anthropic()

    def analyze(self, team_a, team_b, league_hint, user_prompt):
        with self.client.messages.stream(
            model=self.MODEL,
            max_tokens=8000,
            system=SYSTEM_PROMPT,
            tools=[{"type": "web_search_20260209", "name": "web_search"}],
            output_config={"effort": self.EFFORT},
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            response = stream.get_final_message()
        return "".join(block.text for block in response.content if block.type == "text")

    def quick_answer(self, team_a, team_b, search_query, prompt):
        with self.client.messages.stream(
            model=self.MODEL,
            max_tokens=2000,
            system=(
                "You are a factual football research assistant. Ground every answer in a fresh "
                "web search, and say so plainly if you can't find a reliable answer."
            ),
            tools=[{"type": "web_search_20260209", "name": "web_search"}],
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            response = stream.get_final_message()
        return "".join(block.text for block in response.content if block.type == "text")


class GroqProvider(AnalysisProvider):
    """Free tier: Groq-hosted open model, no built-in search — a DuckDuckGo
    text search (also free, no key) fills the gap so injuries/coach/form
    context still reaches the model. Rate limits on both the free Groq tier
    and keyless DuckDuckGo search are tighter than Claude's — expect this to
    be the path that breaks first under load, not the one to build around."""

    MODEL = "llama-3.3-70b-versatile"
    QUERIES = [
        "{a} injuries suspensions news",
        "{b} injuries suspensions news",
        "{a} vs {b} preview prediction",
        "{a} coach manager news form",
        "{b} coach manager news form",
    ]

    def __init__(self, api_key: str):
        from groq import Groq
        self.client = Groq(api_key=api_key)

    def _search_context(self, team_a: str, team_b: str) -> str:
        from ddgs import DDGS
        lines = []
        with DDGS() as ddgs:
            for template in self.QUERIES:
                query = template.format(a=team_a, b=team_b)
                try:
                    results = list(ddgs.text(query, max_results=3))
                except Exception:
                    continue
                for r in results:
                    lines.append(f"[{query}] {r.get('title', '')}: {r.get('body', '')}")
        return "\n".join(lines) if lines else "(web search returned nothing)"

    def analyze(self, team_a, team_b, league_hint, user_prompt):
        search_context = self._search_context(team_a, team_b)
        full_prompt = f"Web search results (use these as your research):\n{search_context}\n\n{user_prompt}"
        completion = self.client.chat.completions.create(
            model=self.MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": full_prompt},
            ],
            max_tokens=4000,
        )
        return completion.choices[0].message.content

    def quick_answer(self, team_a, team_b, search_query, prompt):
        from ddgs import DDGS
        try:
            with DDGS() as ddgs:
                results = list(ddgs.text(search_query, max_results=5))
        except Exception:
            results = []
        context = "\n".join(f"- {r.get('title', '')}: {r.get('body', '')}" for r in results) or "(no results)"
        full_prompt = f"Search results:\n{context}\n\n{prompt}"
        completion = self.client.chat.completions.create(
            model=self.MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": full_prompt},
            ],
            max_tokens=1000,
        )
        return completion.choices[0].message.content


def get_provider(name: str) -> AnalysisProvider:
    if name == "claude":
        return ClaudeProvider()
    if name == "groq":
        from config import GROQ_API_KEY
        if not GROQ_API_KEY:
            raise ValueError("LLM_PROVIDER=groq but GROQ_API_KEY is not set")
        return GroqProvider(GROQ_API_KEY)
    raise ValueError(f"Unknown LLM_PROVIDER={name!r}, available: claude, groq")
