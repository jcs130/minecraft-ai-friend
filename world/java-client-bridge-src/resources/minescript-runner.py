"""Owned finite Minescript job. Game operations use the original Minescript API."""
import builtins
import json
import os
from pathlib import Path
import sys
import threading
import traceback

import minescript

request_path = Path(sys.argv[1])
request = json.loads(request_path.read_text(encoding="utf-8"))
output = Path(request["output"])
# An abrupt JVM exit cannot leave an unbounded Python process behind.
watchdog = threading.Timer((request["timeoutMs"] + 5000) / 1000, lambda: os._exit(124))
watchdog.daemon = True
watchdog.start()
job_id = next(job.job_id for job in minescript.job_info() if job.self)
envelope = {"schemaVersion": 1, "actionId": request["actionId"], "nonce": request["nonce"], "jobId": job_id}

with request_path.with_suffix(".log").open("a", encoding="utf-8") as log:
    def private_print(*args, **kwargs):
        kwargs.setdefault("file", log)
        builtins.print(*args, **kwargs)
        log.flush()

    scope = {"__name__": "__maw_action__", "minescript": minescript, "input_data": request["input"], "result": None, "print": private_print}
    try:
        exec(compile(request["code"], "<maw-finite-script>", "exec"), scope)
        minescript.flush()
        envelope.update(ok=True, value=scope.get("result"))
        # Fail explicitly if the result is not finite JSON or exceeds the reply budget.
        encoded = json.dumps(envelope, ensure_ascii=False, allow_nan=False)
        if len(encoded.encode("utf-8")) > 65536:
            raise ValueError("minescript_result_over_budget")
    except BaseException as error:
        traceback.print_exc(file=log)
        envelope.update(ok=False, errorType=type(error).__name__, errorMessage=str(error)[:1500])
        envelope.pop("value", None)
        encoded = json.dumps(envelope, ensure_ascii=False, allow_nan=False)
    temporary = output.with_suffix(".tmp")
    temporary.write_text(encoded, encoding="utf-8")
    os.replace(temporary, output)
    watchdog.cancel()
