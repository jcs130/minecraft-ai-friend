#!/usr/bin/env python3
"""Tiny non-TS agent for the harness gateway: stdlib only, HTTP transport (POST /v1/messages + polling pull_events).

    HARNESS_URL=http://127.0.0.1:8787 HARNESS_TOKEN_ENV=NEKO_TOKEN python3 examples/python_agent.py

The token is read from the env var named by HARNESS_TOKEN_ENV and never printed.
"""
import itertools
import json
import os
import time
import urllib.error
import urllib.request

URL = os.environ.get("HARNESS_URL", "http://127.0.0.1:8787").rstrip("/")
TOKEN = os.environ.get(os.environ.get("HARNESS_TOKEN_ENV", ""), "")
_ids = itertools.count(1)


def call(msg_type, payload=None):
    body = json.dumps({"v": 1, "id": f"py-{next(_ids)}", "type": msg_type, "payload": payload or {}}).encode()
    req = urllib.request.Request(f"{URL}/v1/messages", data=body, method="POST", headers={"content-type": "application/json"})
    if TOKEN:
        req.add_header("authorization", f"Bearer {TOKEN}")
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            msg = json.load(res)
    except urllib.error.HTTPError as err:  # errors still carry a JSON envelope
        msg = json.load(err)
    if msg["type"] == "error":
        raise RuntimeError(f"{msg['payload']['code']}: {msg['payload']['message']}")
    return msg["payload"]


welcome = call("hello", {"protocols": [1], "client": {"name": "python-example"}})
print(f"[welcome] agent={welcome['agent']} exclusiveBody={welcome['server']['exclusiveBody']}")
cursor, stream = welcome["latest"], welcome["stream"]

intent = call("submit_intent", {"goal": "砍几棵树", "constraints": {"steps": [{"tool": "mc_do", "args": {"steps": [{"skill": "chop_tree"}]}}]}})
print(f"[agent] submitted {intent['intentId']}")

state = "queued"
while state not in ("done", "failed", "cancelled"):
    page = call("pull_events", {"after": cursor, "stream": stream, "limit": 50})
    if page["streamReset"] or page["dropped"]:
        print("[agent] event gap detected (server restarted or buffer overflow)")
    for e in page["events"]:
        print(f"[event #{e['seq']}] ({e['kind']}) {e['text']}")
        if e.get("intentId") == intent["intentId"] and e["kind"] == "intent_state":
            state = e.get("data", {}).get("state", state)
    cursor, stream = page["cursor"], page["stream"]
    time.sleep(0.5)

print(call("get_summary", {"maxTokens": 160})["summary"]["text"])
