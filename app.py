"""Flask server for the multi-agent research pipeline."""

import json
import os
import re
import threading

from flask import Flask, render_template, send_from_directory, abort, jsonify, request
from flask_socketio import SocketIO, join_room
from multi_agent import run_pipeline, PipelineError

app = Flask(__name__)
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

run_lock = threading.Lock()
workspaces = {}


def _workspace_state(workspace_id):
    return workspaces.setdefault(workspace_id, {
        "run_in_progress": False,
        "event_history": [],
    })


def broadcast(event, workspace_id):
    """
    Send one pipeline event to the workspace that started the run.

    This is the function handed to run_pipeline as `on_event`, so it gets
    called from several threads at once (one per parallel researcher). That is
    fine: socketio.emit is safe to call from any thread in threading mode, and
    we take the lock before touching event_history.

    We keep the history so that if you refresh the page mid-run, the new page
    can be replayed everything it missed instead of showing an empty log.
    """
    with run_lock:
        state = _workspace_state(workspace_id)
        state["event_history"].append(event)
    socketio.emit("pipeline_event", event, to=workspace_id)


def pipeline_worker(topic, mode, workspace_id):
    """
    Runs in a background thread: does the actual research, then reports the
    outcome. Anything that goes wrong becomes a "run_failed" event rather than
    a stack trace the browser never sees.
    """
    try:
        run_pipeline(
            topic,
            on_event=lambda event: broadcast(event, workspace_id),
            mode=mode,
        )
    except PipelineError as e:
        broadcast({"type": "run_failed", "error": str(e), "expected": True}, workspace_id)
    except Exception as e:
        broadcast({
            "type": "run_failed",
            "error": f"{type(e).__name__}: {e}",
            "expected": False,
        }, workspace_id)
    finally:
        with run_lock:
            _workspace_state(workspace_id)["run_in_progress"] = False
        socketio.emit("run_finished", {}, to=workspace_id)

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
        return None


def _trace_stats(trace):
    """
    The same numbers the live results screen shows, recomputed from a trace.
    Returns None for anything we cannot know (e.g. a report with no trace).
    """
    if not trace:
        return {"sub_questions_used": None, "sub_questions_total": None, "sources_total": None}
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

@socketio.on("connect")
def on_connect():
    pass


@socketio.on("join_workspace")
def on_join_workspace(data):
    workspace_id = (data or {}).get("workspace_id", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", workspace_id):
        socketio.emit("workspace_rejected", {"reason": "Invalid workspace."}, to=request.sid)
        return

    join_room(workspace_id)
    with run_lock:
        state = _workspace_state(workspace_id)
        busy = state["run_in_progress"]
        missed = list(state["event_history"])
    socketio.emit("workspace_ready", {"workspace_id": workspace_id}, to=request.sid)
    if busy and missed:
        socketio.emit("catch_up", {"events": missed}, to=request.sid)


@socketio.on("start_run")
def on_start_run(data):
    """
    The browser asked to research a topic. Validate, claim the run slot, and
    hand the work to a background thread.
    """
    topic = (data or {}).get("topic", "").strip()
    mode = "deep" if (data or {}).get("mode") == "deep" else "normal"
    workspace_id = (data or {}).get("workspace_id", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", workspace_id):
        socketio.emit("run_rejected", {"reason": "Workspace is not ready."}, to=request.sid)
        return
    if not topic:
        socketio.emit("run_rejected", {"reason": "Please enter a topic."}, to=request.sid)
        return

    with run_lock:
        state = _workspace_state(workspace_id)
        if state["run_in_progress"]:
            socketio.emit("run_rejected", {"reason": "A run is already in progress."},
                          to=request.sid)
            return
        state["run_in_progress"] = True
        state["event_history"].clear()
    socketio.start_background_task(pipeline_worker, topic, mode, workspace_id)


if __name__ == "__main__":
    socketio.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG", "").lower() == "true",
        use_reloader=False,
    )
