#!/usr/bin/env python3
"""Upload an existing screenshot to a player's temporary ImageFrame link."""

import argparse
import json
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import UUID, uuid4

MAX_BYTES = 4 * 1024 * 1024


class UploadError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def upload(screenshot, upload_url):
    """Return transport acceptance only; the game confirms map creation."""
    parts = urlsplit(upload_url.strip())
    query = parse_qs(parts.query)
    if (parts.scheme not in {"http", "https"} or not parts.hostname
            or parts.username or parts.password or parts.fragment
            or parts.path not in {"", "/", "/index.html"}
            or set(query) != {"id"} or len(query["id"]) != 1):
        raise UploadError("Use the temporary page link from your own in-game create command.")
    try:
        upload_id = str(UUID(query["id"][0]))
        parts.port  # Validate the port before creating a request.
    except ValueError as error:
        raise UploadError("Invalid upload link.") from error

    path = Path(screenshot)
    if not path.is_file() or not 0 < path.stat().st_size <= MAX_BYTES:
        raise UploadError("Screenshot must be a nonempty PNG/JPG of at most 4 MiB.")
    data = path.read_bytes()
    if not 0 < len(data) <= MAX_BYTES:
        raise UploadError("Screenshot changed while reading or exceeds 4 MiB.")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        mime, filename = "image/png", "screenshot.png"
    elif data.startswith(b"\xff\xd8\xff"):
        mime, filename = "image/jpeg", "screenshot.jpg"
    else:
        raise UploadError("Screenshot content must be PNG or JPG; do not rename another format.")
    boundary = "imageframe-" + uuid4().hex
    body = (f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'
            f"Content-Type: {mime}\r\n\r\n").encode("ascii")
    body += data + f"\r\n--{boundary}--\r\n".encode("ascii")
    endpoint = urlunsplit((parts.scheme, parts.netloc, "/upload",
                           urlencode({"id": upload_id}), ""))
    request = Request(endpoint, body,
                      {"Content-Type": "multipart/form-data; boundary=" + boundary},
                      method="POST")
    # LAN uploads must not leak bearer links through environment HTTP proxies.
    opener = build_opener(ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=35) as response:
            result = json.loads(response.read(8192).decode("utf-8"))
            if response.status != 200 or "error" in result or not result.get("message"):
                raise UploadError("Server did not accept the screenshot; check the game before retrying.")
    except HTTPError as error:
        raise UploadError(f"Upload rejected (HTTP {error.code}); the link may have expired or been used.") from None
    except (URLError, TimeoutError, OSError, ValueError) as error:
        raise UploadError("Upload result is unknown. Check the game first; do not automatically retry.") from None
    return {"status": "uploaded", "gameConfirmationRequired": True,
            "message": "Wait for ImageFrame creation success and the actual map item in game."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("screenshot", help="Existing PNG/JPG screenshot, at most 4 MiB")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--url", help="Private temporary page link received in game")
    source.add_argument("--url-file", help="UTF-8 file containing only the private page link")
    args = parser.parse_args()
    try:
        url = Path(args.url_file).read_text(encoding="utf-8-sig").strip() if args.url_file else args.url
        print(json.dumps(upload(args.screenshot, url), ensure_ascii=False))
    except (UploadError, OSError, ValueError) as error:
        # Never print the URL, its token, or a traceback containing the request.
        message = str(error) if isinstance(error, UploadError) else "Unable to read the screenshot or link file."
        print(json.dumps({"status": "error", "message": message}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
