"""Bounded current-body images; no desktop capture, URL fetching or old-frame replay."""

import base64
import binascii
import hashlib
import struct
import time

IMAGE_RESERVE = 8192


def latest_png(raw, tool):
    if tool not in {"mc_view_map", "mc_visual"}:
        return None  # Re-fetching an old artifact must not make its capture time fresh.
    if raw.get("isError") or (raw.get("structuredContent") or {}).get("failed"):
        return None
    # These are core-generated PNG artifacts, not a URL from chat or an external viewer.
    for part in reversed(raw.get("content", [])):
        data = part.get("data", "")
        if part.get("type") != "image" or part.get("mimeType") != "image/png" or not isinstance(data, str) or len(data) > 700000:
            continue
        try:
            binary = base64.b64decode(data, validate=True)
            if binary[:8] != b"\x89PNG\r\n\x1a\n" or binary[12:16] != b"IHDR":
                continue
            width, height = struct.unpack(">II", binary[16:24])
            if not (0 < width <= 2048 and 0 < height <= 2048 and width * height <= 2097152):
                continue
        except (ValueError, binascii.Error, struct.error):
            continue
        return {"url": "data:image/png;base64," + data, "received_at": time.monotonic(), "tool": tool,
                "sha256": hashlib.sha256(binary).hexdigest(), "width": width, "height": height}
    return None


def attach_frame(messages, frame):
    if not frame or not 0 <= time.monotonic() - frame["received_at"] <= 15:
        return messages, False
    # Preserve the entire static prefix/history. Current image appears once at the tail.
    result = [*messages[:-1], {**messages[-1], "content": [
        {"type": "text", "text": messages[-1]["content"]},
        {"type": "text", "text": f"Current connection PNG artifact from {frame['tool']}; sha256={frame['sha256']}. Maps are not camera screenshots. Verify coordinates and action outcomes using text facts."},
        {"type": "image_url", "image_url": {"url": frame["url"]}},
    ]}]
    return result, True


def text_only(messages):
    result = []
    for message in messages:
        content = message.get("content")
        if isinstance(content, list):
            content = "\n".join(p.get("text", "") for p in content if p.get("type") == "text")
            result.append({**message, "content": content})
        else:
            result.append(message)
    return result


def has_images(messages):
    return any(isinstance(m.get("content"), list) and any(p.get("type") == "image_url" for p in m["content"]) for m in messages)
