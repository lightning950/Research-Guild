"""
Web server for the multi-agent research pipeline.

Phase A: serves one page, takes a topic, runs the real pipeline in a
background thread, and streams live progress into the browser as plain text.

Architecture, in one paragraph:

    browser  --(socket.io "start_run")-->  Flask-SocketIO
                                              |
                                              | starts a background thread
                                              v
                                          run_pipeline(topic, on_event=...)
                                              |
                                              | calls on_event(...) as things happen
                                              v
    browser  <--(socket.io "pipeline_event")-- broadcast to every connected page

Why a background thread at all: run_pipeline takes 30-90 seconds. If we ran it
inside the HTTP request that started it, the browser would sit on a blank
loading page and we could not report anything until it finished. The whole
point of this UI is showing progress *during* the run, so the run has to
happen outside the request/response cycle.

Why async_mode="threading": most Socket.IO tutorials tell you to install
eventlet or gevent. Both are awkward on Python 3.13 / Windows, and we do not
need them -- "threading" mode uses plain Python threads, which is also what
the pipeline's own ThreadPoolExecutor already uses. Fewer moving parts.
"""

import json
import os
import threading

from flask import Flask, render_template, send_from_directory, abort, jsonify, request
from flask_socketio import SocketIO

# Importing the pipeline unchanged. It knows nothing about Flask -- it just
# accepts an on_event callback -- so eval.py and the command line still work.
from multi_agent import run_pipeline, PipelineError

app = Flask(__name__)
# Flask wants a secret key for session signing. Fine to hardcode for a local
# dev tool; if you ever put this on the internet, move it to .env.
app.config["SECRET_KEY"] = os.environ["FLASK_SECRET_KEY"]

allowed_origins = os.getenv("CORS_ALLOWED_ORIGINS", "*").split(",")
socketio = SocketIO(
    app,
    async_mode="threading",
    cors_allowed_origins=[origin.strip() for origin in allowed_origins],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REPORTS_DIR = os.path.join(BASE_DIR, "reports")
TRACES_DIR = os.path.join(BASE_DIR, "traces")
os.makedirs(REPORTS_DIR, exist_ok=True)
os.makedirs(TRACES_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Run state
#
# We deliberately allow only ONE run at a time. Two reasons: the free API
# tiers (Firecrawl, Groq) will rate-limit you fast if several runs fire at
# once, and "one room, one crew of agents" is much easier to reason about than
# several overlapping runs sharing one set of sprites.
# ---------------------------------------------------------------------------

run_lock = threading.Lock()      # guards the two variables below
run_in_progress = False
event_history = []               # every event of the current run, in order


def broadcast(event):
    """
    Send one pipeline event to every connected browser, and remember it.

    This is the function handed to run_pipeline as `on_event`, so it gets
    called from several threads at once (one per parallel researcher). That is
    fine: socketio.emit is safe to call from any thread in threading mode, and
    we take the lock before touching event_history.

    We keep the history so that if you refresh the page mid-run, the new page
    can be replayed everything it missed instead of showing an empty log.
    """
    with run_lock:
        event_history.append(event)
    socketio.emit("pipeline_event", event)


def pipeline_worker(topic, mode="normal"):
    """
    Runs in a background thread: does the actual research, then reports the
    outcome. Anything that goes wrong becomes a "run_failed" event rather than
    a stack trace the browser never sees.
    """
    global run_in_progress
    try:
        run_pipeline(topic, on_event=broadcast, mode=mode)
    except PipelineError as e:
        # An expected, explainable failure (no plan, no usable sources).
        broadcast({"type": "run_failed", "error": str(e), "expected": True})
    except Exception as e:
        # Anything else: still report it, so the UI never just silently hangs.
        broadcast({"type": "run_failed", "error": f"{type(e).__name__}: {e}", "expected": False})
    finally:
        # Always release the "one run at a time" flag, success or failure.
        with run_lock:
            run_in_progress = False
        socketio.emit("run_finished", {})


# ---------------------------------------------------------------------------
# HTTP routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/download/<path:filename>")
def download_report(filename):
    """
    Serve a finished report from reports/ as a file download.

    os.path.basename strips any directory part from the requested name, so a
    crafted URL like /download/../.env cannot escape the reports folder.
    """
    safe_name = _safe_report_name(filename)
    if not safe_name:
        abort(404)
    return send_from_directory(REPORTS_DIR, safe_name, as_attachment=True)


# ---------------------------------------------------------------------------
# The Archive (Phase C)
#
# Every run already saves reports/<name>.md and traces/<name>_trace.json.
# These two routes just expose what is on disk, so the title screen can list
# past quests and reopen them. No database: the folders ARE the archive.
# ---------------------------------------------------------------------------

def _safe_report_name(filename):
    """
    Reduce a requested name to a bare "<something>.md" inside reports/, or
    return None. basename() strips any "../" so a crafted request cannot read
    files outside the folder (for example your .env).
    """
    name = os.path.basename(filename or "")
    if not name.endswith(".md"):
        return None
    if not os.path.isfile(os.path.join(REPORTS_DIR, name)):
        return None
    return name


def _load_trace(report_name):
    """The trace saved alongside a report, or None if it has no trace."""
    stem = report_name[:-3]
    path = os.path.join(TRACES_DIR, f"{stem}_trace.json")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None          # a corrupt trace should not break the archive


def _trace_stats(trace):
    """
    The same numbers the live results screen shows, recomputed from a trace.
    Returns None for anything we cannot know (e.g. a report with no trace).
    """
    if not trace:
        return {"sub_questions_used": None, "sub_questions_total": None, "sources_total": None}
    # Deep runs add round-2 follow-up questions to the trace; they are extra
    # digging, not extra sub-questions, so only round 1 counts toward "4/5".
    research = [t for t in trace if t.get("step") == "research" and t.get("round", 1) == 1]
    synthesis = next((t for t in trace if t.get("step") == "synthesis"), {})
    deep_stats = next((t for t in trace if t.get("step") == "deep_stats"), None)
    sources = (deep_stats["sources_cited"] if deep_stats and "sources_cited" in deep_stats else
               sum(len(t.get("sources_found", [])) for t in research if t.get("content_found")))
    return {
        "sub_questions_used": synthesis.get("sub_questions_used"),
        "sub_questions_total": len(research),
        "sources_total": sources,
    }


def _mode_for(trace):
    """'deep' for deep-research runs (recorded in the trace), else 'normal'."""
    if trace and trace[0].get("mode") == "deep":
        return "deep"
    return "normal"


def _topic_for(report_name, trace):
    """The original topic text if the trace has it, else rebuilt from the filename."""
    if trace and trace[0].get("topic"):
        return trace[0]["topic"]
    return report_name[:-3].replace("_", " ")


@app.route("/api/reports")
def list_reports():
    """Newest-first list of saved reports, for the Archive screen."""
    entries = []
    if os.path.isdir(REPORTS_DIR):
        for name in os.listdir(REPORTS_DIR):
            if not name.endswith(".md"):
                continue
            path = os.path.join(REPORTS_DIR, name)
            try:
                with open(path, encoding="utf-8") as f:
                    words = len(f.read().split())
                mtime = os.path.getmtime(path)
            except OSError:
                continue
            trace = _load_trace(name)
            entries.append({
                "filename": name,
                "topic": _topic_for(name, trace),
                "modified": mtime,
                "words": words,
                "has_trace": trace is not None,
                "mode": _mode_for(trace),
            })
    entries.sort(key=lambda e: e["modified"], reverse=True)
    return jsonify(entries)


@app.route("/api/reports/<path:filename>")
def get_report(filename):
    """One saved report plus its trace, shaped like a run_complete event."""
    name = _safe_report_name(filename)
    if not name:
        abort(404)
    with open(os.path.join(REPORTS_DIR, name), encoding="utf-8") as f:
        report = f.read()
    trace = _load_trace(name)
    payload = {
        "topic": _topic_for(name, trace),
        "report": report,
        "report_filename": name,
        "trace": trace or [],
    }
    payload.update(_trace_stats(trace))
    payload["mode"] = _mode_for(trace)
    return jsonify(payload)


# ---------------------------------------------------------------------------
# Socket.IO events (the real-time part)
# ---------------------------------------------------------------------------

@socketio.on("connect")
def on_connect():
    """
    A browser just connected. If a run is already going, replay everything it
    has missed so a mid-run page refresh does not show an empty screen.
    """
    with run_lock:
        busy = run_in_progress
        missed = list(event_history)
    if busy and missed:
        # to=request.sid: send the replay ONLY to the browser that just
        # connected. Without it every open tab received it, replayed the whole
        # run from scratch and closed whatever card or report it had open.
        socketio.emit("catch_up", {"events": missed}, to=request.sid)


@socketio.on("start_run")
def on_start_run(data):
    """
    The browser asked to research a topic. Validate, claim the run slot, and
    hand the work to a background thread.
    """
    global run_in_progress

    topic = (data or {}).get("topic", "").strip()
    # Anything other than an explicit "deep" is a normal run, so an old
    # browser tab that doesn't send a mode keeps working exactly as before.
    mode = "deep" if (data or {}).get("mode") == "deep" else "normal"
    if not topic:
        socketio.emit("run_rejected", {"reason": "Please enter a topic."}, to=request.sid)
        return

    with run_lock:
        if run_in_progress:
            # Only the tab that asked is told no. Broadcasting this re-enabled
            # the START button in the tab whose run was still going.
            socketio.emit("run_rejected", {"reason": "A run is already in progress."},
                          to=request.sid)
            return
        # Claim the slot and clear the previous run's history in one go, while
        # still holding the lock, so two fast clicks cannot both get through.
        run_in_progress = True
        event_history.clear()

    # start_background_task is Socket.IO's own thread helper. Using it instead
    # of threading.Thread directly means emits from inside the thread work
    # correctly whatever async_mode is configured.
    socketio.start_background_task(pipeline_worker, topic, mode)


if __name__ == "__main__":
    socketio.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG", "").lower() == "true",
        use_reloader=False,
    )
