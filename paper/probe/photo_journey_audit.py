"""Read-only consistency audit of isolated photo journey evidence.

Telemetry must come from the real host/worker when evidenceKind is real-client.
This auditor cannot authenticate hand-authored logs or replace a human image review.
Missing evidence stays BLOCKED; fixture evidence can never pass real E2E.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import re
import struct
import zlib


def png_info(file):
    raw = file.read_bytes()
    if not 1024 <= len(raw) <= 8 * 1024 * 1024 or raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("invalid PNG size/signature")
    offset, width, height, compressed, ended = 8, 0, 0, bytearray(), False
    while offset + 12 <= len(raw):
        size = struct.unpack_from(">I", raw, offset)[0]
        kind = raw[offset + 4:offset + 8]
        data = raw[offset + 8:offset + 8 + size]
        if len(data) != size or offset + 12 + size > len(raw):
            raise ValueError("truncated PNG")
        crc = struct.unpack_from(">I", raw, offset + 8 + size)[0]
        if zlib.crc32(kind + data) & 0xffffffff != crc:
            raise ValueError("PNG CRC mismatch")
        if kind == b"IHDR":
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", data)
            if not (768 <= width <= 4096 and 768 <= height <= 4096 and depth == 8 and color in (2, 6)
                    and compression == 0 and filtering == 0 and interlace == 0):
                raise ValueError("unsupported or undersized worker PNG")
        elif kind == b"IDAT":
            compressed.extend(data)
        elif kind == b"IEND":
            ended = True
            break
        offset += 12 + size
    if not ended or not width:
        raise ValueError("incomplete PNG")
    expected = height * (1 + width * (3 if color == 2 else 4))
    decoder = zlib.decompressobj()
    pixels = decoder.decompress(bytes(compressed), expected + 1)
    if len(pixels) != expected or not decoder.eof or decoder.unused_data:
        raise ValueError("invalid PNG pixel stream")
    stride = expected // height
    if any(pixels[i] > 4 for i in range(0, expected, stride)):
        raise ValueError("invalid PNG row filter")
    return {"sha256": hashlib.sha256(raw).hexdigest(), "width": width, "height": height, "bytes": len(raw)}


def audit(directory):
    directory = Path(directory).resolve()
    run = json.loads((directory / "run.json").read_text())
    events = [json.loads(line) for line in (directory / "events.jsonl").read_text().splitlines() if line.strip()]
    stages = {}
    def gate(name, ok, reason):
        stages[name] = {"status": "PASS" if ok else "BLOCKED", "reason": reason}
    def rows(kind):
        return [e for e in events if e.get("kind") == kind]
    def last(kind):
        return rows(kind)[-1] if rows(kind) else {"at": -1, "sequence": -1, "data": {}}
    owner = run.get("owner")
    gate("isolated_real_source", run.get("schema") == "photo-journey/v1" and run.get("evidenceKind") == "real-client"
         and bool(re.fullmatch(r"127\.0\.0\.1:\d+", run.get("gameAddress", ""))), "Synthetic fixtures never establish real photography or autonomous behavior.")
    ordered = all(isinstance(e.get("sequence"), int) and isinstance(e.get("at"), (int, float)) for e in events)
    ordered = ordered and all(a["sequence"] < b["sequence"] and a["at"] <= b["at"] for a, b in zip(events, events[1:]))
    gate("event_order", ordered, "Monotonic recorded events required.")
    decision = last("decision"); d = decision["data"]
    hints = [e for e in rows("hint") if e["data"].get("eventId") == d.get("hintId")]
    hint = hints[-1] if hints else {"sequence": -1, "data": {}}
    gate("suggestion_received", bool(hints) and hint["data"].get("recipient") == owner and hint["data"].get("requiresDecision") is True
         and hint["data"].get("type") == "adventure_hint" and hint["data"].get("command", "").startswith("/mycli photo take "),
         "Private hint must be observed separately from a model decision.")
    obs = d.get("observation", {})
    trace_ok = False
    try:
        trace_file = (directory / d.get("traceFile", "")).resolve()
        if trace_file.parent != directory or trace_file.stat().st_size > 1024 * 1024:
            raise ValueError("invalid model trace")
        trace_bytes = trace_file.read_bytes()
        def strings(value, depth=0):
            if depth > 30:
                return []
            if isinstance(value, str):
                values = [value]
                try:
                    decoded = json.loads(value)
                    if isinstance(decoded, (dict, list)):
                        values += strings(decoded, depth + 1)
                except (ValueError, TypeError):
                    pass
                return values
            if isinstance(value, (dict, list)):
                return [s for v in (value.values() if isinstance(value, dict) else value) for s in strings(v, depth + 1)]
            return []
        trace_values = strings(json.loads(trace_bytes))
        trace_ok = hashlib.sha256(trace_bytes).hexdigest() == d.get("traceSha256") \
            and all(d.get(k) in trace_values for k in ("model", "responseId", "toolCallId", "command"))
    except (OSError, ValueError, TypeError):
        pass
    gate("agent_decision", d.get("source") == "model-host-tool-call" and all(d.get(k) for k in ("model", "responseId", "toolCallId"))
         and trace_ok
         and bool(hints) and hint["sequence"] < decision["sequence"] and obs.get("safe") is True and obs.get("cameraReady") is True
         and bool(obs.get("sourceRef")) and isinstance(obs.get("at"), (int, float)) and 0 <= decision["at"] - obs["at"] <= 15000,
         "Requires a matching original model tool-call trace and fresh safety/camera observation; suggestion alone is insufficient.")
    submitted = last("submitted"); command = submitted["data"].get("command", "")
    parsed = re.fullmatch(r"/mycli photo take ([\w-]{1,32}) (third|first|top) ([12]) --story (.+)", command)
    gate("request_submitted", bool(parsed) and command == d.get("command") and submitted["data"].get("toolCallId") == d.get("toolCallId")
         and submitted["sequence"] > decision["sequence"], "Actual command submission must match the model's tool call and include its story.")
    name, mode, tiles, story = parsed.groups() if parsed else (None, None, "1", None)
    image = last("image")["data"]; digest = None
    try:
        file = (directory / image.get("file", "")).resolve()
        if file.parent != directory:
            raise ValueError("image must be in run directory")
        digest = png_info(file)
        diag = image.get("diagnostics", {})
        valid_image = digest["sha256"] == image.get("sha256") and image.get("owner") == owner and image.get("mode") == mode \
            and bool(diag.get("nativeInstance")) and "intel" in diag.get("renderer", "").lower() \
            and diag.get("width") == digest["width"] and diag.get("height") == digest["height"]
    except (OSError, ValueError, KeyError, struct.error, zlib.error):
        valid_image = False
    gate("actual_image_artifact", valid_image and run.get("evidenceKind") == "real-client"
         and last("image")["sequence"] > submitted["sequence"], "Exact worker PNG must follow submission and decode with matching SHA-256; ACKs do not count as pixels.")
    job = image.get("job")
    receipts = [e["data"] for e in rows("receipt") if e["data"].get("job") == job and job and e["sequence"] > submitted["sequence"]]
    success = [r for r in receipts if r.get("status") == "success" and r.get("jobStatus") == "success" and r.get("name") == name and r.get("owner") == owner]
    receipt = success[-1] if success else {}
    gate("game_completion", bool(success) and bool(receipt.get("mapIds")), "Original job/owner/name and authoritative delivery IDs required; uploading/unknown/idle are not success.")
    album = last("album")["data"]
    gate("private_album", bool(job) and album.get("id") == job and album.get("owner") == owner and album.get("name") == name
         and album.get("story") == story and album.get("published") is False and album.get("imageIndex") == receipt.get("imageIndex")
         and album.get("mapIds") == receipt.get("mapIds") and album.get("worldUuid") == image.get("world")
         and bool(digest) and album.get("image", {}).get("sha256") == digest["sha256"],
         "Same private original, author story, digest and native map IDs must be recoverable from album.")
    stash = last("stash")["data"]
    expected_ids = receipt.get("mapIds", [])
    found = stash.get("storedMapIds", []) + stash.get("pendingMapIds", [])
    counts = collections.Counter(found)
    gate("personal_storage", bool(expected_ids) and len(expected_ids) == int(tiles) ** 2 and len(set(expected_ids)) == len(expected_ids)
         and stash.get("owner") == owner and stash.get("imageIndex") == receipt.get("imageIndex")
         and stash.get("mapIds") == expected_ids and all(counts[i] == 1 for i in expected_ids),
         "Each original tile appears once in the owner's existing stash or private overflow.")
    gate("single_request", len(rows("submitted")) == 1, "Happy-path/recovery trace must not resubmit a new photo; duplicate-request faults use a separate run.")
    return {"schema": "photo-journey-audit/v1", "evidenceComplete": all(s["status"] == "PASS" for s in stages.values()),
            "stages": stages, "job": job, "image": digest,
            "limits": "Consistency audit of supplied evidence, not authentication of hand-authored logs. Human image review and real host provenance remain required. Does not measure suggestion frequency across sessions."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = audit(args.evidence)
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        with args.report.open("x", encoding="utf-8") as out:
            out.write(text)
    print(text)
    raise SystemExit(0 if result["evidenceComplete"] else 2)


if __name__ == "__main__":
    main()
