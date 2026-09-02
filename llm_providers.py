"""LLM provider adapter layer — same idea as bookmakers.py: analysis.py only
talks to AnalysisProvider, switching the model that does the reasoning is a
config value change, not a rewrite.

Only Claude has *native* web search built into the API call. Gemini has its
own native Google Search grounding tool, so it gets one too. Groq has
neither, so its adapter does its own DuckDuckGo pass and stuffs the snippets
into the prompt before asking the model to reason over them — that research
step is the entire point of this bot, so a free path that skipped it would
just be worse than doing nothing. Expect materially shallower analysis from
the free paths regardless — a free model doing web-adjacent reasoning is not
the same as Opus 5 doing genuine multi-step research.

get_provider_chain() builds a resilience chain over LLM_PROVIDER +
LLM_FALLBACK_PROVIDERS (see config.py): if the primary hits a rate limit or
its quota is exhausted, the next configured provider takes the call instead
of the analysis failing outright. It deliberately only catches rate-limit-
shaped errors (_is_rate_limited) — a genuine bug or bad request in one
provider should surface immediately, not get silently masked by quietly
switching models.
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


class GeminiProvider(AnalysisProvider):
    """Free tier: Gemini with its own native Google Search grounding tool —
    unlike Groq, no DIY DuckDuckGo pass needed. Model id and the exact free-
    tier grounding quota are worth re-checking against a live key before
    relying on this in production; Google's free-tier terms for grounded
    search have shifted before and this hasn't been exercised against a real
    account here."""

    MODEL = "gemini-2.0-flash"

    def __init__(self, api_key: str):
        from google import genai
        self.genai = genai
        self.client = genai.Client(api_key=api_key)

    def _generate(self, system: str, prompt: str, max_tokens: int) -> str:
        response = self.client.models.generate_content(
            model=self.MODEL,
            contents=prompt,
            config=self.genai.types.GenerateContentConfig(
                system_instruction=system,
                tools=[self.genai.types.Tool(google_search=self.genai.types.GoogleSearch())],
                max_output_tokens=max_tokens,
            ),
        )
        return response.text or ""

    def analyze(self, team_a, team_b, league_hint, user_prompt):
        return self._generate(SYSTEM_PROMPT, user_prompt, 8000)

    def quick_answer(self, team_a, team_b, search_query, prompt):
        return self._generate(
            "You are a factual football research assistant. Ground every answer in a fresh "
            "web search, and say so plainly if you can't find a reliable answer.",
            prompt,
            2000,
        )


def _is_rate_limited(exc: Exception) -> bool:
    """True for a quota/rate-limit condition specifically — the only case
    get_provider_chain() falls through to the next provider for. Checked by
    HTTP status code where the SDKs expose one (429 rate-limited, 529
    Anthropic-specific "overloaded" — both mean "not now", not "broken"),
    falling back to each SDK's own named exception class so this still works
    if a status_code attribute isn't present."""
    status = getattr(exc, "status_code", None)
    if status in (429, 529):
        return True
    type_name = type(exc).__name__
    return type_name in ("RateLimitError", "ResourceExhausted", "TooManyRequests")


class FallbackProvider(AnalysisProvider):
    """Tries each provider in order, moving to the next only on a rate-limit/
    quota error (see _is_rate_limited) — any other exception propagates
    immediately, so a real bug in one provider isn't mistaken for "try the
    next one" and silently hidden behind a working fallback."""

    def __init__(self, providers: list[tuple[str, AnalysisProvider]]):
        if not providers:
            raise ValueError("FallbackProvider needs at least one provider")
        self.providers = providers

    def _try_each(self, call_name: str, *args) -> str:
        last_exc: Exception | None = None
        for name, provider in self.providers:
            try:
                return getattr(provider, call_name)(*args)
            except Exception as exc:
                if not _is_rate_limited(exc):
                    raise
                last_exc = exc
                continue
        raise last_exc  # every provider in the chain was rate-limited

    def analyze(self, team_a, team_b, league_hint, user_prompt):
        return self._try_each("analyze", team_a, team_b, league_hint, user_prompt)

    def quick_answer(self, team_a, team_b, search_query, prompt):
        return self._try_each("quick_answer", team_a, team_b, search_query, prompt)


def get_provider(name: str) -> AnalysisProvider:
    if name == "claude":
        return ClaudeProvider()
    if name == "groq":
        from config import GROQ_API_KEY
        if not GROQ_API_KEY:
            raise ValueError("LLM_PROVIDER=groq but GROQ_API_KEY is not set")
        return GroqProvider(GROQ_API_KEY)
    if name == "gemini":
        from config import GEMINI_API_KEY
        if not GEMINI_API_KEY:
            raise ValueError("LLM_PROVIDER=gemini but GEMINI_API_KEY is not set")
        return GeminiProvider(GEMINI_API_KEY)
    raise ValueError(f"Unknown LLM_PROVIDER={name!r}, available: claude, groq, gemini")


def get_provider_chain() -> AnalysisProvider:
    """LLM_PROVIDER is always tried first; LLM_FALLBACK_PROVIDERS (comma-
    separated, e.g. "groq,gemini") are tried in order after it, but only on
    a rate-limit/quota error. Built eagerly (every provider in the chain is
    constructed up front) so a fallback with a missing API key fails loudly
    at the start of the call instead of silently vanishing from the chain
    mid-analysis. No fallback configured -> identical to get_provider(), no
    wrapping, no behavior change from before this existed."""
    from config import LLM_FALLBACK_PROVIDERS, LLM_PROVIDER

    names = [LLM_PROVIDER] + [p.strip() for p in LLM_FALLBACK_PROVIDERS.split(",") if p.strip()]
    if len(names) == 1:
        return get_provider(names[0])
    return FallbackProvider([(name, get_provider(name)) for name in names])


def demo():
    """Self-check for FallbackProvider's branching — fake providers, no real
    API keys or network, matching the rest of the project's demo() style."""

    class _RateLimited(Exception):
        status_code = 429

    class _Broken(Exception):
        pass

    class _FakeProvider:
        def __init__(self, behavior):
            self.behavior = behavior  # "ok" | "rate_limited" | "broken"
            self.calls = 0

        def analyze(self, *a):
            self.calls += 1
            if self.behavior == "rate_limited":
                raise _RateLimited("quota exceeded")
            if self.behavior == "broken":
                raise _Broken("bad request")
            return "ok-response"

        def quick_answer(self, *a):
            return self.analyze(*a)

    # rate-limited primary falls through to a working fallback
    primary, fallback = _FakeProvider("rate_limited"), _FakeProvider("ok")
    chain = FallbackProvider([("primary", primary), ("fallback", fallback)])
    assert chain.analyze("A", "B", None, "prompt") == "ok-response"
    assert primary.calls == 1 and fallback.calls == 1

    # a genuine bug must NOT trigger fallback — it should propagate as-is
    primary2, fallback2 = _FakeProvider("broken"), _FakeProvider("ok")
    chain2 = FallbackProvider([("primary", primary2), ("fallback", fallback2)])
    try:
        chain2.analyze("A", "B", None, "prompt")
        raise AssertionError("expected _Broken to propagate, not fall through")
    except _Broken:
        pass
    assert fallback2.calls == 0, "a non-rate-limit error must not touch the next provider"

    # every provider rate-limited -> the last rate-limit error is raised, not swallowed
    chain3 = FallbackProvider([("a", _FakeProvider("rate_limited")), ("b", _FakeProvider("rate_limited"))])
    try:
        chain3.analyze("A", "B", None, "prompt")
        raise AssertionError("expected the exhausted chain to raise")
    except _RateLimited:
        pass

    assert _is_rate_limited(_RateLimited())
    assert not _is_rate_limited(_Broken())

    print("llm_providers.py self-check OK")


if __name__ == "__main__":
    demo()
