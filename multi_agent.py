from concurrent.futures import ThreadPoolExecutor, as_completed
import os
from dotenv import load_dotenv
from firecrawl import FirecrawlApp
from google import genai
from groq import Groq
import time
import json
import re
import sys

import web_sources   # free-first page sourcing shared with deep mode

# Windows consoles default to the cp1252 encoding, which cannot represent many
# characters the models happily produce (smart quotes, en-dashes, the
# non-breaking hyphen U+2011, emoji...). print() then raises
# UnicodeEncodeError and kills the run -- not because anything is wrong with
# the research, but because it could not be *displayed*.
#
# Switching stdout to UTF-8 with errors="replace" means an unprintable
# character shows as a placeholder instead of crashing the pipeline.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass  # Not all environments expose reconfigure; never fail on this.

load_dotenv()

firecrawl_key = os.getenv("FIRECRAWL_API_KEY")
gemini_key = os.getenv("GEMINI_API_KEY")

app = FirecrawlApp(api_key=firecrawl_key)
client = genai.Client(api_key=gemini_key)
groq_key = os.getenv("GROQ_API_KEY")
groq_client = Groq(api_key=groq_key)
print("Keys loaded successfully")


# ---------------------------------------------------------------------------
# Progress events (added for the web UI)
#
# The pipeline used to report progress only two ways: print() while running,
# and the `trace` list, which you only get back AFTER everything finishes.
# A live UI needs to know things the moment they happen, so every function
# below now takes an optional `on_event` callback.
#
# on_event=None (the default) means "nobody is watching" and the pipeline
# behaves exactly as it did before. eval.py and the command-line run pass
# nothing, so they are unaffected.
# ---------------------------------------------------------------------------

# Agent ids used in events. The UI keys its sprites off these exact strings,
# so keep them stable.
PLANNER = "planner"
SYNTHESIZER = "synthesizer"
VERIFIER = "verifier"


def researcher_id(index):
    """Researchers are numbered, because there are 2-5 of them per run."""
    return f"researcher-{index}"


class PipelineError(Exception):
    """
    Raised when the pipeline genuinely cannot continue.

    This replaces the old exit() calls. exit() was wrong for two reasons:
    a web server must not kill its own process because one research run
    failed, and exit() raises SystemExit, which is NOT a subclass of
    Exception -- so eval.py's `except Exception` never caught it and a
    single planning failure aborted the whole eval.
    """
    pass


def _emit(on_event, event_type, **payload):
    """
    Hand one progress event to whoever is watching the run.

    Args:
        on_event: the callback, or None if nothing is watching.
        event_type: short string the UI switches on, e.g. "agent_state".
        **payload: any extra fields for that event type.

    The try/except matters: this is called from inside the pipeline, including
    from the parallel researcher threads. A bug in the UI's callback must never
    be able to take down a research run, so we log it and carry on.
    """
    if on_event is None:
        return
    payload["type"] = event_type
    payload["ts"] = time.time()
    try:
        on_event(payload)
    except Exception as e:
        print(f"[on_event callback raised, ignoring] {e}")


def _state(on_event, agent, state, message, **extra):
    """
    Shorthand for the most common event: "this agent is now doing this".

    `state` is what the UI animates (idle / thinking / searching / reading /
    typing / waiting / done / failed) and `message` is the human-readable line
    shown in the dialogue box.

    **extra carries structured numbers (urls_found, done, total, ...) so the
    UI can draw real progress meters instead of parsing English out of the
    message text.
    """
    _emit(on_event, "agent_state", agent=agent, state=state, message=message, **extra)


def _short_url(url):
    """Just the domain, so log lines and speech bubbles stay readable."""
    return re.sub(r"^https?://(www\.)?", "", url).split("/")[0]


def _groq_chat(prompt, on_event=None, agent=None, retry_message="Model call failed"):
    """
    Ask Groq for a completion, retrying up to 3 times with a 10s pause.

    All four agents (planner, researcher, synthesizer, verifier) had an
    identical copy of this loop. Pulling it into one function means a retry
    only has to be reported to the UI in one place, and there is one place to
    change if the model name ever changes.

    Returns the model's text, or None if all 3 attempts failed. Callers decide
    what to do about None, exactly as they did before.
    """
    for attempt in range(3):
        try:
            response = groq_client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[{"role": "user", "content": prompt}],
                # "low" cuts the model's hidden reasoning tokens by ~90%
                # (measured: 803 -> ~12 per call) with no visible quality loss.
                # Those hidden tokens count against Groq's free 8,000
                # tokens-per-minute limit, so they were the main reason runs
                # sat waiting. Same model, same prompts, same output format.
                reasoning_effort="low",
            )
            return response.choices[0].message.content
        except Exception as e:
            print(f"Attempt {attempt + 1} failed: {e}")
            if attempt < 2:
                print("Retrying in 10 seconds...")
                if agent:
                    _state(on_event, agent, "waiting",
                           f"{retry_message} (attempt {attempt + 1}/3) - retrying in 10s...")
                time.sleep(10)
    return None


def plan_topic(topic, min_q=2, max_q=5, on_event=None):
    prompt = f"""
Break down the topic "{topic}" into {min_q} to {max_q} focused sub-questions
worth researching separately. Pick the number based on how broad or narrow
the topic is — a narrow topic might only need 2, a broad one up to 5.

Return ONLY the sub-questions, one per line, no numbering, no extra text.
"""
    _state(on_event, PLANNER, "thinking", "Studying the topic...")

    response_text = _groq_chat(prompt, on_event, PLANNER, "Planner call failed")

    if response_text is None:
        _state(on_event, PLANNER, "failed", "Could not reach the oracle.")
        raise Exception("Groq API failed after 3 attempts")

    lines = response_text.strip().split("\n")
    sub_questions = [line.strip("- ").strip() for line in lines if line.strip()]
    return sub_questions

def find_urls(query, num_results=5, on_event=None, agent=None):
    """
    Search the web (DuckDuckGo, free) for a sub-question.

    Asks for twice as many results as we need: about half of all sites block
    direct downloads (measured 16 of 30 readable), and research_subquestion
    stops as soon as it has `num_results` readable pages.
    """
    print(f"  Searching: {query}")
    if agent:
        _state(on_event, agent, "searching", "Searching the archives...")
    hits, error = web_sources.search(query, max_results=num_results * 2)
    if error:
        print(f"  Search problem for {query!r}: {error}")
    urls = [h["url"] for h in hits]
    if agent:
        _state(on_event, agent, "searching",
               f"Found {len(urls)} promising sources.", urls_found=len(urls))
    return urls

def scrape_url(url, guard=None):
    """
    Readable text of one page, trimmed to 3,000 characters as before.

    Tries a free direct download first. Only if the site blocks that does it
    fall back to Firecrawl, and only if the FirecrawlGuard allows it (enough
    credits, not a PDF, under the per-run cap and the per-minute limit).
    Previously every Firecrawl error -- including rate limits -- was silently
    swallowed here, so reports lost pages without anyone knowing.
    """
    if web_sources._blocked(url):
        return None
    content = web_sources.fetch_text(url)
    if not content and guard is not None:
        content = guard.try_scrape(url)
    return content[:3000] if content else None

def research_subquestion(sub_question, index=0, on_event=None, guard=None):
    """
    Research one sub-question.

    `index` is new: it tells the UI which researcher sprite this work belongs
    to. These run in parallel threads, so events from different researchers
    will interleave -- that is expected, and is why each one is tagged.
    """
    agent = researcher_id(index)
    print(f"Researching: {sub_question}")
    urls = find_urls(sub_question, num_results=5, on_event=on_event, agent=agent)

    content = ""
    sources = []
    # Pages are fetched in parallel (8 at a time) and gathering stops once 5
    # are readable. Fetching them one after another made a normal run take
    # ~150s: each site that blocks downloads can hold a scout for 10s.
    def on_page(done, total, url, ok):
        _state(on_event, agent, "reading", f"Reading {_short_url(url)}",
               url=_short_url(url), done=done, total=total)

    pages, problems = web_sources.gather_urls(urls, want=5, guard=guard, on_page=on_page)
    for page in pages:
        content += f"\n\n---\nSource: {page['url']}\n\n{page['text'][:3000]}"
        sources.append(page["url"])

    if not content:
        _state(on_event, agent, "failed", "Found nothing usable.",
               done=len(urls), total=len(urls))
        return {"question": sub_question, "summary": "No usable content found.", "sources": []}

    prompt = f"""
Based on the following scraped content, write a focused 150-200 word summary
answering this question: "{sub_question}"

Only use facts present in the content below. Do not add outside knowledge.

Content:
{content}
"""

    # "typing" is the animation state for a sprite at a keyboard.
    _state(on_event, agent, "typing",
           f"Writing up {len(sources)} sources...",
           done=len(urls), total=len(urls), sources_used=len(sources))
    summary_text = _groq_chat(prompt, on_event, agent, "Summary call failed")

    if summary_text is None:
        summary_text = "Summary generation failed."
        _state(on_event, agent, "failed", "Could not write a summary.")
    else:
        _state(on_event, agent, "done",
               f"Notes complete - {len(sources)} sources cited.",
               sources_used=len(sources))

    return {"question": sub_question, "summary": summary_text, "sources": sources}

def synthesize_report(topic, research_results, on_event=None):
    combined = ""
    for r in research_results:
        combined += f"\n\n## Sub-question: {r['question']}\n{r['summary']}\nSources: {', '.join(r['sources'])}"

    prompt = f"""
You are a research analyst. Below are summaries answering different sub-questions
about the topic "{topic}". Merge them into one coherent, well-structured report.

Formatting rules:
- Use clear markdown headers
- Do not just concatenate the summaries — synthesize them, resolve any overlaps,
  and note if any sub-questions revealed contradicting information
- List all sources once at the end, deduplicated
- Keep it professional and concise

Structure:
## Overview
## Key Findings
## Contradictions or Gaps
## Sources

Sub-question summaries:
{combined}
"""

    _state(on_event, SYNTHESIZER, "typing",
           f"Weaving {len(research_results)} sets of notes together...",
           total=len(research_results))
    report_text = _groq_chat(prompt, on_event, SYNTHESIZER, "Synthesis call failed")

    if report_text is None:
        report_text = "Synthesis failed."
        _state(on_event, SYNTHESIZER, "failed", "Synthesis failed.")
    else:
        _state(on_event, SYNTHESIZER, "done", "The report is written.")

    return report_text


def verify_report(final_report, research_results, on_event=None):
    source_summaries = ""
    for r in research_results:
        source_summaries += f"\n\n{r['question']}\n{r['summary']}"

    prompt = f"""
You are a fact-checker. Below is a final synthesized report, followed by the
original research summaries it was built from.

Check whether the final report accurately reflects the original summaries.
Flag anything in the final report that:
- Is not supported by the original summaries
- Contradicts the original summaries
- Was added from outside knowledge during synthesis

Keep your response to 3-4 sentences. If the report looks accurate and well-grounded, say so clearly.

Final Report:
{final_report}

Original Research Summaries:
{source_summaries}
"""

    _state(on_event, VERIFIER, "reading", "Cross-checking every claim against the notes...")
    verification_text = _groq_chat(prompt, on_event, VERIFIER, "Verifier call failed")

    if verification_text is None:
        verification_text = "Verification step failed to run."
        _state(on_event, VERIFIER, "failed", "Verification could not run.")
    else:
        _state(on_event, VERIFIER, "done", "Every claim checked. Sealed.")

    return verification_text


def run_pipeline(topic, on_event=None, mode="normal"):
    """
    Run the full research pipeline for one topic.

    on_event is optional. Pass a function taking a single dict to receive live
    progress events while the run is in flight (this is what the web UI does).
    Pass nothing and the pipeline behaves exactly as it always has.

    mode="normal" (the default) is the original pipeline below, unchanged, so
    eval.py and existing callers are unaffected. mode="deep" hands off to
    deep_research.py: a paper-style report, time-boxed to 5 minutes.
    """
    if mode == "deep":
        # Imported here, not at the top, so normal runs never load it. We pass
        # this module in so deep_research shares our API clients and helpers
        # without a circular import.
        from deep_research import run_deep
        return run_deep(topic, on_event, sys.modules[__name__])
    if mode != "normal":
        raise ValueError(f"Unknown mode {mode!r}; use 'normal' or 'deep'.")

    trace=[]  #creates an empty list that we'll fill with a record of each step as the pipeline runs

    _emit(on_event, "run_started", topic=topic)

    print("\nPlanning sub-questions...")
    try:
        sub_questions = plan_topic(topic, on_event=on_event)
    except Exception as e:
        print(f"Planning failed completely: {e}")
        print("Cannot continue without a research plan.")
        # Was exit(). See PipelineError's docstring for why that was a problem.
        raise PipelineError(f"Planning failed: {e}")

    trace.append({
        "step": "planning",
        "topic": topic,
        "sub_questions_generated": sub_questions
    })

    print(f"Generated {len(sub_questions)} sub-questions:")
    for q in sub_questions:
        print(f"  - {q}")

    # The UI needs this before anything else: it decides how many researcher
    # sprites to put in the room (2-5, however many this topic produced).
    _emit(on_event, "plan_ready", sub_questions=sub_questions)
    _state(on_event, PLANNER, "done",
           f"Split the quest into {len(sub_questions)} lines of inquiry.",
           sub_questions=len(sub_questions))

    print("\nResearching each sub-question (in parallel)...")
    research_results = []
    # One guard per run: caps Firecrawl fallback at 10 credits for this run.
    guard = web_sources.FirecrawlGuard(app, credit_cap=10)
    for line in guard.log:
        print("  " + line)

    with ThreadPoolExecutor(max_workers=len(sub_questions)) as executor: #creates a pool of workers, one per sub-question, so all of them can run at the same time instead of waiting in line
        # enumerate() so each researcher carries the index of its own sprite.
        future_to_question = {
            executor.submit(research_subquestion, q, i, on_event, guard): q
            for i, q in enumerate(sub_questions)
        }

        for future in as_completed(future_to_question):
            q = future_to_question[future]
            try:
                result = future.result()
            except Exception as e:
                print(f"Research failed for '{q}': {e}")
                result = {"question": q, "summary": "No usable content found.", "sources": []}
            research_results.append(result)
            trace.append({
                "step": "research",
                "question": q,
                "sources_found": result["sources"],
                "content_found": result["summary"] != "No usable content found."
            })

    successful_results = [r for r in research_results if r["summary"] != "No usable content found."]

    if not successful_results:
        print("All sub-questions failed to find usable content. Cannot generate a report.")
        raise PipelineError("All sub-questions failed to find usable content.")

    print(f"{len(successful_results)} of {len(research_results)} sub-questions returned usable content.")

    print("\nSynthesizing final report...")
    final_report = synthesize_report(topic, successful_results, on_event=on_event)
    trace.append({"step": "synthesis", "sub_questions_used": len(successful_results)})

    print("\nVerifying final report...")
    verification_note = verify_report(final_report, successful_results, on_event=on_event)
    final_report += f"\n\n---\n\n**Verification Note:** {verification_note}"
    trace.append({"step": "verification", "note": verification_note})

    os.makedirs("reports", exist_ok=True)
    filename = f"reports/{safe_filename(topic)}.md"
    with open(filename, "w", encoding="utf-8") as f:
        f.write(final_report)

    print(f"\nReport saved to {filename}")
    os.makedirs("traces", exist_ok=True)
    trace_filename = f"traces/{safe_filename(topic)}_trace.json"
    with open(trace_filename, "w", encoding="utf-8") as f:
        json.dump(trace, f, indent=2)

    print(f"Trace saved to {trace_filename}")

    # Everything the results screen needs, in one final event.
    _emit(
        on_event,
        "run_complete",
        topic=topic,
        report=final_report,
        verification_note=verification_note,
        trace=trace,
        report_filename=os.path.basename(filename),
        sub_questions_used=len(successful_results),
        sub_questions_total=len(research_results),
        sources_total=sum(len(r["sources"]) for r in successful_results),
    )

    return final_report, verification_note, trace

def safe_filename(topic):
    safe = re.sub(r'[^\w\s-]', '', topic)
    safe = safe.strip().replace(' ', '_')
    return safe
if __name__ == "__main__":
    # python multi_agent.py          -> normal research
    # python multi_agent.py --deep   -> deep research paper (max 5 minutes)
    mode = "deep" if "--deep" in sys.argv else "normal"
    topic = input(f"What topic do you want to research ({mode})? ")
    run_pipeline(topic, mode=mode)