"""Time-boxed deep research mode used by :mod:`multi_agent`."""

import json
import os
import re
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import groq

import web_sources

DEADLINE_SECONDS = 300
SAFETY_RESERVE = 15
SUB_QUESTIONS = (4, 5)
SOURCES_ROUND_1 = 6
SOURCES_ROUND_2 = 4
EXCERPT_CHARS = 1800
FIRECRAWL_CREDIT_CAP = 25
PAPERS_PER_SCOUT = 2

MODELS = {
    "gpt-oss-120b":  {"id": "openai/gpt-oss-120b", "tpm": 8000,  "rpm": 30, "extra": {"reasoning_effort": "low"}},
    "gpt-oss-20b":   {"id": "openai/gpt-oss-20b",  "tpm": 8000,  "rpm": 30, "extra": {"reasoning_effort": "low"}},
    "qwen3.8-27b":   {"id": "qwen/qwen3.8-27b",    "tpm": 8000,  "rpm": 30, "extra": {}},
    "compound-mini": {"id": "groq/compound-mini",  "tpm": 8000,  "rpm": 30, "extra": {},
                      "also_charges": ["gpt-oss-120b"]},
}
ROLES = {
    "plan":    ["gpt-oss-120b", "qwen3.8-27b"],
    "extract": ["qwen3.8-27b", "gpt-oss-20b", "gpt-oss-120b", "compound-mini"],
    "review":  ["gpt-oss-120b", "qwen3.8-27b", "compound-mini"],
    "write":   ["qwen3.8-27b", "gpt-oss-120b", "gpt-oss-20b", "compound-mini"],
    "frame":   ["gpt-oss-120b", "qwen3.8-27b", "compound-mini"],
    "verify":  ["qwen3.8-27b", "gpt-oss-120b", "gpt-oss-20b", "compound-mini"],
}

BLOCKED_DOMAINS = ["facebook.com", "twitter.com", "x.com", "instagram.com",
                   "linkedin.com", "tiktok.com", "pinterest.com"]


class DeadlineReached(Exception):
    """Raised when there is no time left to start another model call."""


class QuotaExhausted(Exception):
    """Raised when every model allowed for a job is out of its free quota."""

class Deadline:
    def __init__(self, seconds):
        self.start = time.monotonic()
        self.seconds = seconds

    def elapsed(self):
        return time.monotonic() - self.start

    def remaining(self):
        """Seconds left before we must start wrapping up."""
        return self.seconds - SAFETY_RESERVE - self.elapsed()

def estimate_tokens(text):
    """Cheap token estimate: roughly 3.5 characters per token for English."""
    return int(len(text) / 3.5) + 50


class Bucket:
    """
    One model's free-tier budget, tracked over a sliding 60-second window.

    Each accepted call is recorded as [timestamp, tokens]. Before a call we
    check whether the tokens used in the last minute plus this call would
    stay under the limit. We aim for 90% of the limit because our token
    estimate is approximate.
    """

    def __init__(self, name, cfg):
        self.name = name
        self.cfg = cfg
        self.lock = threading.Lock()
        self.window = deque()
        self.blocked_until = 0.0
        self.out_for_today = False

    def _prune(self, now):
        while self.window and self.window[0][0] < now - 60:
            self.window.popleft()

    def fits_at_all(self, tokens):
        return tokens <= self.cfg["tpm"] * 0.9

    def try_reserve(self, tokens):
        """
        Reserve room for a call. Returns (reservation, 0) on success, or
        (None, seconds_to_wait) if this bucket is currently full.
        """
        now = time.monotonic()
        with self.lock:
            if self.out_for_today:
                return None, float("inf")
            if now < self.blocked_until:
                return None, self.blocked_until - now
            self._prune(now)
            used = sum(t for _, t in self.window)
            limit = self.cfg["tpm"] * 0.9
            if used + tokens <= limit and len(self.window) < self.cfg["rpm"]:
                entry = [now, tokens]
                self.window.append(entry)
                return entry, 0.0
            freed, wait = 0, 60.0
            for ts, t in self.window:
                freed += t
                if used - freed + tokens <= limit:
                    wait = ts + 60 - now
                    break
            return None, max(0.5, wait)

    def settle(self, entry, actual_tokens):
        """Replace the estimate with what the call really used."""
        with self.lock:
            entry[1] = actual_tokens

    def charge(self, tokens):
        """Record tokens spent on this model by a call made through another model."""
        with self.lock:
            self.window.append([time.monotonic(), tokens])


class ModelPool:
    def __init__(self, client, deadline, on_wait=None):
        self.client = client.with_options(max_retries=0)
        self.deadline = deadline
        self.buckets = {name: Bucket(name, cfg) for name, cfg in MODELS.items()}
        self.on_wait = on_wait
        self.usage = {name: 0 for name in MODELS}
        self.calls = {name: 0 for name in MODELS}
        self.errors = []
        self.lock = threading.Lock()

    def _note(self, model, role, err):
        msg = str(err)
        kind = re.search(r"on ((?:input |output )?tokens|requests) per (minute|day)", msg)
        named = re.search(r"for model `([^`]+)`", msg)
        prefix = ""
        if kind:
            via = f" via {named.group(1)}" if named else ""
            prefix = f"[{kind.group(1)}/{kind.group(2)}{via}] "
        line = f"{model} on {role}: {prefix}{type(err).__name__}: {msg[:160]}"
        with self.lock:
            self.errors.append(line)
        print(f"[deep] {line}")

    def call(self, role, prompt, max_out, json_mode=False, agent=None, max_wait=60.0):
        """
        Run one completion for `role`. Returns the text.

        Raises DeadlineReached if the clock runs out while waiting for room,
        or QuotaExhausted if every allowed model is out of its daily budget.
        """
        estimate = estimate_tokens(prompt) + max_out
        skip = set()
        attempts = 0
        started = time.monotonic()

        while True:
            if self.deadline.remaining() < 4:
                raise DeadlineReached(role)
            if time.monotonic() - started > max_wait:
                raise QuotaExhausted(f"{role}: no capacity within {max_wait:.0f}s")

            names = [n for n in ROLES[role] if n not in skip
                     and not self.buckets[n].out_for_today
                     and self.buckets[n].fits_at_all(estimate)]
            if not names:
                raise QuotaExhausted(role)

            chosen, entry, shortest = None, None, float("inf")
            for n in names:
                entry, wait = self.buckets[n].try_reserve(estimate)
                if entry is not None:
                    chosen = n
                    break
                shortest = min(shortest, wait)

            if chosen is None:
                wait = min(shortest, 8.0, max(0.0, self.deadline.remaining() - 4),
                           max(0.0, max_wait - (time.monotonic() - started)) + 0.05)
                if wait <= 0:
                    raise DeadlineReached(role)
                if self.on_wait and agent and wait >= 2:
                    self.on_wait(agent, wait)
                time.sleep(wait)
                continue

            cfg = MODELS[chosen]
            timeout = max(8.0, min(45.0, self.deadline.remaining() - 2))
            kwargs = dict(cfg["extra"])
            if json_mode and chosen != "compound-mini":
                kwargs["response_format"] = {"type": "json_object"}
            try:
                resp = self.client.with_options(timeout=timeout).chat.completions.create(
                    model=cfg["id"],
                    messages=[{"role": "user", "content": prompt}],
                    max_completion_tokens=max_out,
                    **kwargs,
                )
                used = getattr(resp.usage, "total_tokens", None) or estimate
                self.buckets[chosen].settle(entry, used)
                for other in cfg.get("also_charges", []):
                    self.buckets[other].charge(used)
                with self.lock:
                    self.usage[chosen] += used
                    self.calls[chosen] += 1
                return resp.choices[0].message.content or ""

            except groq.RateLimitError as e:
                self.buckets[chosen].settle(entry, 0)
                self._note(chosen, role, e)
                msg = str(e)
                targets = {chosen}
                named = re.search(r"for model `([^`]+)`", msg)
                if named:
                    for name, mcfg in MODELS.items():
                        if mcfg["id"] == named.group(1):
                            targets.add(name)
                daily = "per day" in msg or "(TPD)" in msg or "(RPD)" in msg
                m = re.search(r"try again in ([\d.]+)(ms|s)", msg)
                wait = (float(m.group(1)) / (1000 if m.group(2) == "ms" else 1)) if m else 5.0
                for t in targets:
                    if daily and t != chosen:
                        self.buckets[t].out_for_today = True
                    elif daily:
                        self.buckets[t].out_for_today = True
                    else:
                        self.buckets[t].blocked_until = time.monotonic() + max(wait, 1.0)
            except groq.APIStatusError as e:
                self.buckets[chosen].settle(entry, 0)
                skip.add(chosen)
                self._note(chosen, role, e)
            except (groq.APITimeoutError, groq.APIConnectionError) as e:
                self.buckets[chosen].settle(entry, 0)
                skip.add(chosen)
                self._note(chosen, role, e)

            attempts += 1
            if attempts > 6:
                raise QuotaExhausted(role)

STOPWORDS = set("""a an and are as at be been but by can could did do does for from had has have how
if in into is it its of on or should so than that the their them then there these they this to
was were what when where which while who why will with would about after before between during
more most other over same some such only own very just also any each few many much""".split())


def _terms(text):
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 2 and w not in STOPWORDS}


def select_relevant(markdown, question, budget=EXCERPT_CHARS):
    """
    Keep the paragraphs of a page that best match the question.

    No model call: plain keyword overlap. Paragraphs are scored by how many
    distinct question words they contain (normalised by length so long
    paragraphs don't win by default), with a small bonus for appearing early.
    Link-heavy lines (menus, footers, "related articles") are dropped first.
    The chosen paragraphs are returned in their ORIGINAL order, so the excerpt
    still reads coherently.
    """
    if not markdown:
        return ""
    terms = _terms(question)
    paragraphs = []
    for i, block in enumerate(re.split(r"\n\s*\n", markdown)):
        text = block.strip()
        if len(text) < 60:
            continue
        links = len(re.findall(r"\]\(", text))
        words = max(1, len(text.split()))
        if links / words > 0.08:
            continue
        text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
        text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
        hits = len(terms & _terms(text))
        score = hits / (words ** 0.35) + (0.3 if i < 6 else 0)
        paragraphs.append((score, i, text))

    chosen, used = [], 0
    for score, i, text in sorted(paragraphs, key=lambda p: -p[0]):
        if score <= 0 and chosen:
            break
        piece = text[: budget - used]
        chosen.append((i, piece))
        used += len(piece) + 2
        if used >= budget:
            break
    return "\n\n".join(t for _, t in sorted(chosen))

class SourceRegistry:
    """Gives every distinct URL one citation number, safely across threads."""

    def __init__(self):
        self.lock = threading.Lock()
        self.by_url = {}
        self.items = []

    def add(self, url, title):
        with self.lock:
            if url in self.by_url:
                return self.by_url[url]
            sid = len(self.items) + 1
            self.by_url[url] = sid
            self.items.append({"id": sid, "url": url, "title": (title or "").strip() or url})
            return sid


FRAME_PARTS = ("ABSTRACT", "INTRODUCTION", "DISCUSSION", "LIMITATIONS", "CONCLUSION")


def parse_framing(text):
    """
    Split the framing call's output into its five named parts.

    Tolerant on purpose: models vary the heading decoration between runs
    ("### ABSTRACT", "## Abstract", "**ABSTRACT**", "### 1. Abstract:"). A
    strict parser silently dropped all five parts in one real run, leaving a
    paper with no abstract, introduction or conclusion.
    """
    pattern = re.compile(r"^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?[ \t]*(?:\d+[.)][ \t]*)?"
                         r"(ABSTRACT|INTRODUCTION|DISCUSSION|LIMITATIONS|CONCLUSIONS?)\b"
                         r"[ \t]*(?:\*\*)?[ \t]*:?[ \t]*(?:\*\*)?[ \t]*$",
                         re.IGNORECASE | re.MULTILINE)
    marks = list(pattern.finditer(text or ""))
    parts = {}
    for i, m in enumerate(marks):
        key = m.group(1).upper().rstrip("S") if m.group(1).upper().startswith("CONCLUSION") else m.group(1).upper()
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        body = text[m.end():end].strip()
        if body and key not in parts:
            parts[key] = body
    return parts


def _domain(url):
    return re.sub(r"^https?://(www\.)?", "", url).split("/")[0]


def _parse_json(text):
    """Models occasionally wrap JSON in prose or code fences; dig it out."""
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        m = re.search(r"\{.*\}", text or "", re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except ValueError:
                pass
    return None

def run_deep(topic, on_event, core):
    """
    Deep research for `topic`. `core` is the multi_agent module, passed in
    (rather than imported) so this file shares its API clients, event helpers
    and file naming without a circular import.

    Returns (final_report, verification_note, trace), same as normal mode.
    """
    deadline = Deadline(DEADLINE_SECONDS)
    emit, state = core._emit, core._state
    PLANNER, SCRIBE, WARDEN = core.PLANNER, core.SYNTHESIZER, core.VERIFIER
    trace, timings = [], {}

    def phase(name, message):
        timings[name] = round(deadline.elapsed(), 1)
        print(f"[deep {deadline.elapsed():5.1f}s] {message}")
        emit(on_event, "phase", phase=name, message=message,
             elapsed=round(deadline.elapsed(), 1), deadline=DEADLINE_SECONDS)

    last_wait_note = {}

    def on_wait(agent, seconds):
        now = time.monotonic()
        if now - last_wait_note.get(agent, 0) < 6:
            return
        last_wait_note[agent] = now
        state(on_event, agent, "waiting",
              f"Waiting {seconds:.0f}s for free model capacity...")

    pool = ModelPool(core.groq_client, deadline, on_wait=on_wait)
    registry = SourceRegistry()
    fetch_problems = []
    guard = web_sources.FirecrawlGuard(core.app, credit_cap=FIRECRAWL_CREDIT_CAP)
    source_mix = {}

    emit(on_event, "run_started", topic=topic, mode="deep", deadline=DEADLINE_SECONDS)
    phase("planning", "The planner is designing the study.")
    state(on_event, PLANNER, "thinking", "Designing the study...")
    plan_prompt = f"""You are planning a research paper on: "{topic}".

Break it into {SUB_QUESTIONS[0]} or {SUB_QUESTIONS[1]} focused sub-questions that together cover the topic
in depth (background, mechanisms or causes, evidence and data, debates or
limitations, implications). For each, write an effective web search query of at
most 10 words.

Also say whether the topic is biomedical or life-science (health, medicine,
biology, nutrition, ecology/environmental health): those topics can use a
scientific paper database.

Return ONLY JSON:
{{"title": "a precise paper title",
  "biomedical": true or false,
  "sub_questions": [{{"question": "...", "search_query": "..."}}]}}"""
    try:
        plan = _parse_json(pool.call("plan", plan_prompt, 900, json_mode=True, agent=PLANNER)) or {}
    except (DeadlineReached, QuotaExhausted) as e:
        state(on_event, PLANNER, "failed", "No model capacity to plan the study.")
        raise core.PipelineError(f"Planning failed: free model capacity unavailable ({e})")

    items = [q for q in plan.get("sub_questions", []) if isinstance(q, dict) and q.get("question")]
    items = items[: SUB_QUESTIONS[1]]
    if len(items) < 2:
        state(on_event, PLANNER, "failed", "The plan came back empty.")
        raise core.PipelineError("Planning failed: the model returned no usable sub-questions.")
    title = (plan.get("title") or topic).strip()
    biomedical = plan.get("biomedical") is True
    questions = [q["question"].strip() for q in items]
    queries = [(q.get("search_query") or q["question"]).strip() for q in items]
    trace.append({"step": "planning", "topic": topic, "mode": "deep", "title": title,
                  "biomedical": biomedical, "sub_questions_generated": questions})
    emit(on_event, "plan_ready", sub_questions=questions, mode="deep", title=title)
    state(on_event, PLANNER, "done", f"Study designed: {len(questions)} lines of inquiry.",
          sub_questions=len(questions))
    def scout(index, question, query, n_sources, round_no):
        agent = core.researcher_id(index)
        label = "Follow-up" if round_no == 2 else "Searching"
        state(on_event, agent, "searching", f"{label}: {query}")

        def on_page(done, total, url, ok):
            state(on_event, agent, "reading", f"Reading {_domain(url)}",
                  url=_domain(url), done=done, total=total)

        try:
            if biomedical:
                with ThreadPoolExecutor(max_workers=2) as both:
                    web_future = both.submit(web_sources.gather, query, n_sources, guard, on_page, True)
                    paper_future = both.submit(web_sources.europepmc_papers, question, PAPERS_PER_SCOUT)
                    web_pages, problems = web_future.result()
                    papers, paper_problems = paper_future.result()
                problems = problems + paper_problems
                seen = {p["url"] for p in papers}
                pages = papers + [p for p in web_pages if p["url"] not in seen]
                pages = pages[: n_sources + 1]
            else:
                pages, problems = web_sources.gather(query, n_sources, guard=guard, on_page=on_page)
        except web_sources.SourcesUnavailable as e:
            raise core.PipelineError(str(e))
        fetch_problems.extend(problems)
        for page in pages:
            source_mix[page["via"]] = source_mix.get(page["via"], 0) + 1
        if not pages:
            state(on_event, agent, "failed", "No readable sources.")
            return None
        state(on_event, agent, "searching", f"Kept {len(pages)} readable sources.", urls_found=len(pages))

        got = []
        for page in pages:
            text = select_relevant(page["text"], question + " " + topic)
            if len(text) >= 200:
                got.append((registry.add(page["url"], page["title"]), page["url"], page["title"], text))
        if not got:
            state(on_event, agent, "failed", "No relevant passages found.")
            return None

        excerpts = "\n\n".join(
            f"[{sid}] {(title or _domain(url))} ({_domain(url)})\n{text}"
            for sid, url, title, text in got)
        prompt = f"""You are a research scout contributing to a paper on "{topic}".
Your question: "{question}"

Extract the facts from the numbered source excerpts below that answer the question.
Rules:
- Use ONLY the excerpts. No outside knowledge.
- Write 8 to 14 bullet points.
- End EVERY bullet with its citation number(s) exactly as given, like [3] or [3][7].
- Keep concrete numbers, dates, names and study results.
- If sources disagree, add a bullet starting with "Conflict:".
- Finish with a line starting "Gaps:" naming 1-3 things the sources did not answer.

Source excerpts:
{excerpts}"""
        state(on_event, agent, "typing", f"Extracting findings from {len(got)} sources...",
              done=len(pages), total=len(pages), sources_used=len(got))
        try:
            findings = pool.call("extract", prompt, 900, agent=agent)
        except (DeadlineReached, QuotaExhausted):
            state(on_event, agent, "failed", "Ran out of time to write notes.")
            return None
        if not findings.strip():
            state(on_event, agent, "failed", "Could not write notes.")
            return None
        bullets = sum(1 for line in findings.splitlines() if line.strip().startswith(("-", "*", "•")))
        state(on_event, agent, "done", f"Notes complete: {bullets} findings, {len(got)} sources.",
              sources_used=len(got))
        return {"question": question, "agent": agent, "round": round_no, "findings": findings,
                "source_ids": [sid for sid, _, _, _ in got],
                "sources": [url for _, url, _, _ in got]}

    phase("research", f"{len(questions)} scouts head out.")
    with ThreadPoolExecutor(max_workers=len(questions)) as ex:
        futures = [ex.submit(scout, i, q, queries[i], SOURCES_ROUND_1, 1) for i, q in enumerate(questions)]
        notes = [f.result() for f in futures]

    for q, n in zip(questions, notes):
        trace.append({"step": "research", "question": q, "round": 1,
                      "sources_found": n["sources"] if n else [], "content_found": bool(n)})
    notes_by_q = {i: n for i, n in enumerate(notes) if n}
    if not notes_by_q:
        raise core.PipelineError("All sub-questions failed to find usable content.")
    for n in notes_by_q.values():
        emit(on_event, "handoff", from_agent=n["agent"], to_agent=SCRIBE,
             message=f"{n['agent']} delivers notes")
    phase("review", "The planner reviews the notes for gaps.")
    state(on_event, PLANNER, "thinking", "Reviewing the scouts' notes for gaps...")
    digest = "\n\n".join(f"SUB-QUESTION {i + 1}: {n['question']}\n{n['findings'][:1700]}"
                         for i, n in notes_by_q.items())
    review_prompt = f"""You are the lead author of a research paper titled "{title}".
Below are the scouts' notes for each sub-question.

1. Design the paper's body: 4 to 6 themed sections. For each, give a title, a
   one-sentence focus, and which sub-question numbers it draws on.
2. Find up to 2 important gaps the notes leave open. For each gap, write a
   follow-up question, a web search query (max 10 words), and the index (0-based)
   of the section it would strengthen. Return an empty list if the notes are thorough.

Return ONLY JSON:
{{"sections": [{{"title": "...", "focus": "...", "draws_on": [1, 2]}}],
  "follow_ups": [{{"question": "...", "search_query": "...", "section": 0}}]}}

Notes:
{digest}"""
    try:
        review = _parse_json(pool.call("review", review_prompt, 1200, json_mode=True, agent=PLANNER)) or {}
    except (DeadlineReached, QuotaExhausted):
        review = {}

    sections = []
    for s in review.get("sections", [])[:6]:
        if not isinstance(s, dict) or not s.get("title"):
            continue
        draws = [int(d) - 1 for d in s.get("draws_on", []) if str(d).isdigit() and int(d) - 1 in notes_by_q]
        sections.append({"title": s["title"].strip(), "focus": (s.get("focus") or "").strip(),
                         "draws": draws or list(notes_by_q)[:1], "extra": []})
    if len(sections) < 2:
        sections = [{"title": n["question"].rstrip("?"), "focus": "", "draws": [i], "extra": []}
                    for i, n in notes_by_q.items()]
    state(on_event, PLANNER, "done", f"Outline ready: {len(sections)} sections.")
    follow_ups = [f for f in review.get("follow_ups", []) if isinstance(f, dict) and f.get("question")][:2]
    rounds = 1
    if follow_ups and deadline.remaining() >= 170:
        rounds = 2
        assignments = [{"agent": core.researcher_id(i), "question": f["question"]}
                       for i, f in enumerate(follow_ups)]
        phase("round2", f"The planner sends {len(follow_ups)} scouts back out.")
        emit(on_event, "round2", assignments=assignments)
        with ThreadPoolExecutor(max_workers=len(follow_ups)) as ex:
            futures = [ex.submit(scout, i, f["question"], f.get("search_query") or f["question"],
                                 SOURCES_ROUND_2, 2) for i, f in enumerate(follow_ups)]
            extra_notes = [fu.result() for fu in futures]
        for f, n in zip(follow_ups, extra_notes):
            trace.append({"step": "research", "question": f["question"], "round": 2,
                          "sources_found": n["sources"] if n else [], "content_found": bool(n)})
            if n:
                target = f.get("section", 0)
                target = target if isinstance(target, int) and 0 <= target < len(sections) else 0
                sections[target]["extra"].append(n["findings"])
                emit(on_event, "handoff", from_agent=n["agent"], to_agent=SCRIBE,
                     message=f"{n['agent']} delivers follow-up notes")
    elif follow_ups:
        phase("round2_skipped", "No time for a second round; writing with what we have.")
    remaining = deadline.remaining()
    words = 450 if remaining > 120 else 320 if remaining > 75 else 200
    phase("writing", f"The scribe writes {len(sections)} sections (~{words} words each).")

    SECTION_NOTES_CHARS = 6500

    def material_for(sec):
        parts = [notes_by_q[i]["findings"] for i in sec["draws"] if i in notes_by_q]
        material = "\n\n".join(parts + sec["extra"])
        if len(material) > SECTION_NOTES_CHARS:
            material = material[:SECTION_NOTES_CHARS].rsplit("\n", 1)[0]
        return material

    written = [None] * len(sections)
    progress = [0]
    progress_lock = threading.Lock()

    def write(k):
        sec = sections[k]
        emit(on_event, "section", index=k, title=sec["title"], status="started", total=len(sections))
        prompt = f"""Write the section "{sec['title']}" of a research paper titled "{title}".
Focus: {sec['focus'] or 'as the title says'}
Length: about {words} words. Formal, precise, analytical tone.

Rules:
- Use ONLY the notes below. Do not add outside facts.
- Keep the numbered citations exactly as they appear, e.g. [4] or [4][9], after the claims they support.
- Synthesise: compare sources, explain causes and implications, and point out disagreements.
- You may include ONE small markdown table if it genuinely helps compare figures.
- No section heading, no references list, no concluding summary of the whole paper.

Notes:
{material_for(sec)}"""
        try:
            text = pool.call("write", prompt, int(words * 2.2), agent=SCRIBE)
        except (DeadlineReached, QuotaExhausted):
            text = ""
        written[k] = text.strip()
        with progress_lock:
            progress[0] += 1
            state(on_event, SCRIBE, "typing", f"Wrote section {progress[0]} of {len(sections)}: {sec['title']}",
                  done=progress[0], total=len(sections))
        emit(on_event, "section", index=k, title=sec["title"], status="done",
             words=len(text.split()), total=len(sections))

    state(on_event, SCRIBE, "typing", f"Drafting {len(sections)} sections...", done=0, total=len(sections))
    with ThreadPoolExecutor(max_workers=3) as ex:
        list(ex.map(write, range(len(sections))))

    body_sections = [(sections[k], written[k]) for k in range(len(sections)) if written[k]]
    if not body_sections:
        body_sections = [({"title": notes_by_q[i]["question"].rstrip("?")}, notes_by_q[i]["findings"])
                         for i in notes_by_q]
    state(on_event, SCRIBE, "done", "All sections drafted.")
    phase("verifying", "The warden checks every section while the scribe frames the paper.")
    framing = {}
    verdicts = [None] * len(body_sections)

    def frame():
        summary = "\n\n".join(f"SECTION: {s['title']}\n{text[:700]}" for s, text in body_sections)
        gaps = "\n".join(line for n in notes_by_q.values() for line in n["findings"].splitlines()
                         if line.strip().lower().startswith(("gaps:", "- conflict:", "conflict:", "* conflict:")))
        prompt = f"""You are finishing a research paper titled "{title}" on "{topic}".
Below are the opening parts of its body sections and the open gaps/conflicts the research found.

Write these parts, using only this material (no new facts, no citations needed):
(about 150 words)
(about 180 words: context, why it matters, what the paper covers)
(about 220 words: what the findings mean together, tensions between them)
(about 110 words: be concrete about what the sources could not establish)
(about 140 words)

Use exactly those five ### headings, in that order.

Body sections:
{summary}

Gaps and conflicts found:
{gaps or '(none recorded)'}"""
        for attempt, role in enumerate(("frame", "write")):
            if deadline.remaining() < 20:
                break
            try:
                text = pool.call(role, prompt, 1800, agent=SCRIBE)
            except (DeadlineReached, QuotaExhausted) as e:
                pool.errors.append(f"framing attempt {attempt + 1}: {type(e).__name__}")
                continue
            parsed = parse_framing(text)
            for key, value in parsed.items():
                framing.setdefault(key, value)
            if len(framing) == len(FRAME_PARTS):
                break
            pool.errors.append(f"framing attempt {attempt + 1} returned {sorted(parsed)} of {len(FRAME_PARTS)} parts")

    def verify(k):
        sec, text = body_sections[k]
        state(on_event, WARDEN, "reading", f"Checking section {k + 1}: {sec['title']}",
              done=k, total=len(body_sections))
        if deadline.remaining() < 10:
            return
        material = material_for(sec) if "draws" in sec else text
        prompt = f"""You are a strict fact-checker. Compare the SECTION against the NOTES it was written from.
Flag any claim that is not supported by the notes, contradicts them, or cites the wrong source number.
The notes are model-written extracts, not proof that the original web page or PDF
is accurate. Do not mark a claim supported merely because a citation number is
present. If the notes do not explicitly support it, mark it unsupported.

Return ONLY JSON: {{"verdict": "supported" | "minor_issues" | "unsupported",
                   "issues": ["short description", "..."]}}  (at most 3 issues)

SECTION:
{text}

NOTES:
{material[:6000]}"""
        try:
            verdicts[k] = _parse_json(pool.call("verify", prompt, 400, json_mode=True, agent=WARDEN))
        except (DeadlineReached, QuotaExhausted):
            verdicts[k] = None

    with ThreadPoolExecutor(max_workers=4) as ex:
        framing_future = ex.submit(frame)
        list(ex.map(verify, range(len(body_sections))))
        framing_future.result()

    checked = [v for v in verdicts if isinstance(v, dict)]
    counts = {"supported": 0, "minor_issues": 0, "unsupported": 0}
    issues = []
    for (sec, _), v in zip(body_sections, verdicts):
        if isinstance(v, dict):
            verdict = v.get("verdict") if v.get("verdict") in counts else "minor_issues"
            counts[verdict] += 1
            for issue in (v.get("issues") or [])[:2]:
                if isinstance(issue, str) and issue.strip() and verdict != "supported":
                    short = issue.strip()
                    short = short if len(short) <= 180 else short[:177].rsplit(" ", 1)[0] + "..."
                    issues.append(f"{sec['title']}: {short}")
    if checked:
        verification_note = ("This is a notes-level check, not independent proof of the original sources. " +
                             f"Checked {len(checked)} of {len(body_sections)} sections claim-by-claim against "
                             f"the scouts' notes: {counts['supported']} fully supported, "
                             f"{counts['minor_issues']} with minor issues, {counts['unsupported']} unsupported.")
        if issues:
            verification_note += " Flagged: " + "; ".join(issues[:4]) + "."
        if len(checked) < len(body_sections):
            verification_note += " Remaining sections were not checked before the time limit."
        warden_msg = f"Checked {len(checked)} sections. {counts['supported']} fully supported."
    else:
        verification_note = "Verification did not run: the 5-minute limit was reached first."
        warden_msg = "No time left to verify."
    state(on_event, WARDEN, "done" if checked else "failed", warden_msg)
    trace.append({"step": "verification", "note": verification_note, "verdicts": verdicts})
    phase("filing", "The scribe assembles and files the paper.")
    body = []
    n = 1
    if framing.get("INTRODUCTION"):
        body.append(f"## {n}. Introduction\n\n{framing['INTRODUCTION']}")
        n += 1
    method = (f"This report was compiled on {date.today():%d %B %Y} from {len(registry.items)} web sources "
              f"gathered in {rounds} research round{'s' if rounds > 1 else ''} across {len(notes_by_q)} "
              f"sub-questions. Relevant passages were extracted from each source, condensed into cited notes, "
              f"and synthesised into the sections below; each section was then checked against those notes. "
              f"Sources are open-web pages and were not independently peer reviewed.")
    body.append(f"## {n}. Method\n\n{method}")
    n += 1
    for sec, text in body_sections:
        body.append(f"## {n}. {sec['title']}\n\n{text}")
        n += 1
    for key, label in (("DISCUSSION", "Discussion"), ("LIMITATIONS", "Limitations"), ("CONCLUSION", "Conclusion")):
        if framing.get(key):
            body.append(f"## {n}. {label}\n\n{framing[key]}")
            n += 1
    body_text = "\n\n".join(body)
    order = []
    for m in re.finditer(r"\[(\d{1,3})\]", body_text):
        sid = int(m.group(1))
        if 1 <= sid <= len(registry.items) and sid not in order:
            order.append(sid)
    remap = {old: new for new, old in enumerate(order, start=1)}
    body_text = re.sub(r"\[(\d{1,3})\]",
                       lambda m: f"[{remap[int(m.group(1))]}]" if int(m.group(1)) in remap else m.group(0),
                       body_text)
    refs = [registry.items[old - 1] for old in order]
    uncited = [s for s in registry.items if s["id"] not in remap]
    ref_lines = [f"{remap[s['id']]}. {s['title']} — {_domain(s['url'])} — <{s['url']}>" for s in refs]
    ref_lines += [f"- {s['title']} — {_domain(s['url'])} — <{s['url']}> *(consulted, not cited)*" for s in uncited]

    total_words = len(body_text.split()) + len(framing.get("ABSTRACT", "").split())
    meta = (f"*Deep research report · {date.today():%d %b %Y} · {len(refs)} cited sources · "
            f"{rounds} research round{'s' if rounds > 1 else ''} · ~{total_words:,} words · "
            f"{deadline.elapsed():.0f}s*")
    parts = [f"# {title}", meta]
    if framing.get("ABSTRACT"):
        parts.append(f"## Abstract\n\n{framing['ABSTRACT']}")
    parts += [body_text, "## References\n\n" + "\n".join(ref_lines)]
    final_report = "\n\n".join(parts) + f"\n\n---\n\n**Verification Note:** {verification_note}"

    trace.append({"step": "synthesis", "sub_questions_used": len(notes_by_q), "sections": len(body_sections),
                  "rounds": rounds, "words": total_words})
    trace.append({"step": "deep_stats", "elapsed_s": round(deadline.elapsed(), 1), "timings": timings,
                  "fetch_problems": fetch_problems[:40], "model_errors": pool.errors,
                  "firecrawl": {"spent": guard.spent, "log": guard.log[:40]},
                  "source_mix": source_mix, "biomedical": biomedical,
                  "framing_parts": sorted(framing),
                  "tokens_by_model": pool.usage, "calls_by_model": pool.calls,
                  "sources_consulted": len(registry.items), "sources_cited": len(refs)})

    stem = core.safe_filename(topic) + "_deep"
    os.makedirs("reports", exist_ok=True)
    os.makedirs("traces", exist_ok=True)
    with open(f"reports/{stem}.md", "w", encoding="utf-8") as f:
        f.write(final_report)
    with open(f"traces/{stem}_trace.json", "w", encoding="utf-8") as f:
        json.dump(trace, f, indent=2)
    print(f"[deep] saved reports/{stem}.md in {deadline.elapsed():.1f}s")

    emit(on_event, "run_complete", topic=topic, mode="deep", title=title, report=final_report,
         verification_note=verification_note, trace=trace, report_filename=f"{stem}.md",
         sub_questions_used=len(notes_by_q), sub_questions_total=len(questions),
         sources_total=len(refs), words=total_words, rounds=rounds,
         elapsed_s=round(deadline.elapsed(), 1))
    return final_report, verification_note, trace
