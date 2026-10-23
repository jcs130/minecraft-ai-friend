"""Private bounded failure metadata. Never serialize exception text or locals."""

import hashlib
import json
import uuid
from collections import deque
from contextvars import ContextVar
from datetime import datetime, timezone


current = ContextVar("runtime_failure_diagnostics", default=None)


class FailureDiagnostics:
    def __init__(self, directory, session):
        self.directory, self.session = directory, session
        self.id = str(uuid.uuid4())
        self.path = directory / "runtime-diagnostics" / (self.id + ".json")
        self.first = None
        self.exceptions = []
        self.seen = []
        self.available = False

    def reference(self):
        return {"diagnostic_id": self.id, "diagnostic_available": self.available}

    def capture(self, error, operation):
        if self.first is None:
            self.first = error
        if any(error is previous for previous in self.seen) or len(self.exceptions) >= 12:
            return
        self.seen.append(error)
        frames, trace = deque(maxlen=8), error.__traceback__
        while trace:
            module = trace.tb_frame.f_globals.get("__name__", "")
            frames.append({"module": module[:80] if isinstance(module, str) and module.startswith("agent_mc_autonomy.") else "external",
                           "line": trace.tb_lineno})
            trace = trace.tb_next
        filename = getattr(error, "filename", None)
        self.exceptions.append({"class": type(error).__name__[:80], "operation": operation[:80],
                                "secondary": error is not self.first,
                                "errno": error.errno if isinstance(getattr(error, "errno", None), int) else None,
                                "winerror": error.winerror if isinstance(getattr(error, "winerror", None), int) else None,
                                "path_sha256": hashlib.sha256(filename.encode()).hexdigest() if isinstance(filename, str) else None,
                                "frames": list(frames)})
        record = {"id": self.id, "runtime_session": self.session,
                  "updated_at": datetime.now(timezone.utc).isoformat(), "exceptions": self.exceptions}
        # Diagnostics must never replace the originating exception, even when
        # the same disk/ACL fault prevents recording it.
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(".tmp")
            temporary.write_text(json.dumps(record, separators=(",", ":")), encoding="utf-8")
            temporary.replace(self.path)
            self.available = True
        except Exception:
            self.available = False


def capture_current(error, operation):
    recorder = current.get()
    if recorder is not None:
        recorder.capture(error, operation)
