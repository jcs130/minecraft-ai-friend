"""Explicit public resource preparation, with no real network or child process."""

import hashlib
import io
import stat
import threading
import zipfile

import httpx
import pytest

from agent_mc_autonomy.runtime_bundle import BundleError
from agent_mc_autonomy.runtime_bundle.download import (
    ReleaseBundle,
    fetch_archive,
    unpack_archive,
)


def spec(payload, **extra):
    return ReleaseBundle.parse(
        {
            "schema": "agent-mc-runtime-download/v1",
            "platform": "win32",
            "architecture": "x64",
            "url": "https://github.com/fixture/runtime/releases/download/v1/runtime.zip",
            "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "manifest_sha256": "a" * 64,
            "expanded_bytes": 16,
            **extra,
        }
    )


def test_streams_only_pinned_bytes_and_reports_progress(tmp_path):
    payload = b"verified runtime"
    rows = []
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, content=payload)
        )
    ) as client:
        path = fetch_archive(
            spec(payload), tmp_path, client=client, progress=rows.append
        )
    assert path.read_bytes() == payload
    assert rows[-1]["downloaded_bytes"] == len(payload)
    assert rows[-1]["total_bytes"] == len(payload)


@pytest.mark.parametrize(
    "payload", [b"wrong", b"verified runtimf", b"verified runtimeextra"]
)
def test_bad_size_or_hash_never_creates_verified_archive(tmp_path, payload):
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, content=payload)
        )
    ) as client:
        with pytest.raises(BundleError):
            fetch_archive(spec(b"verified runtime"), tmp_path, client=client)
    assert not list(tmp_path.glob("*.zip"))


def test_redirect_cannot_send_a_request_to_an_untrusted_host(tmp_path):
    visited = []

    def handler(request):
        visited.append(request.url.host)
        return httpx.Response(
            302, headers={"location": "https://untrusted.invalid/runtime.zip"}
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(BundleError, match="redirect"):
            fetch_archive(spec(b"data"), tmp_path, client=client)
    assert visited == ["github.com"]


def test_approved_redirect_and_explicit_retry(tmp_path):
    payload = b"data"

    def handler(request):
        if request.url.host == "github.com":
            return httpx.Response(
                302,
                headers={
                    "location": "https://release-assets.githubusercontent.com/runtime.zip?signature=opaque"
                },
            )
        return httpx.Response(200, content=payload)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert (
            fetch_archive(spec(payload), tmp_path, client=client).read_bytes()
            == payload
        )
        assert (
            fetch_archive(spec(payload), tmp_path, client=client).read_bytes()
            == payload
        )


def test_cancel_before_network_keeps_other_files(tmp_path):
    cancel = threading.Event()
    cancel.set()
    old = tmp_path / "old-runtime.txt"
    old.write_text("keep")
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda request: pytest.fail("network after cancel")
        )
    ) as client:
        with pytest.raises(BundleError, match="cancelled"):
            fetch_archive(spec(b"data"), tmp_path, client=client, cancelled=cancel)
    assert old.read_text() == "keep"


@pytest.mark.parametrize(
    "url",
    [
        "http://github.com/runtime.zip",
        "https://user:pass@github.com/runtime.zip",
        "https://127.0.0.1/runtime.zip",
    ],
)
def test_descriptor_rejects_untrusted_initial_urls(url):
    with pytest.raises(BundleError):
        spec(b"data", url=url)


def archive(rows):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as z:
        for name, body, mode in rows:
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            info.external_attr = mode << 16
            z.writestr(info, body)
    return output.getvalue()


@pytest.mark.parametrize(
    "rows",
    [
        [("../escape", b"data", stat.S_IFREG)],
        [("/absolute", b"data", stat.S_IFREG)],
        [("link", b"target", stat.S_IFLNK)],
        [("file", b"x", stat.S_IFREG), ("FILE", b"x", stat.S_IFREG)],
        [("file", b"x", stat.S_IFREG), ("file/child", b"x", stat.S_IFREG)],
        [("CON.txt", b"x", stat.S_IFREG)],
    ],
)
def test_rejects_unsafe_zip_before_writing_any_member(tmp_path, rows):
    payload = archive(rows)
    path = tmp_path / "input.zip"
    path.write_bytes(payload)
    destination = tmp_path / "stage"
    with pytest.raises(BundleError):
        unpack_archive(
            path,
            destination,
            spec(payload, expanded_bytes=sum(len(row[1]) for row in rows)),
        )
    assert not destination.exists()


def test_exact_zip_sizes_and_manifest_hash_before_preparation(tmp_path, monkeypatch):
    payload = archive(
        [
            ("runtime-manifest.json", b"{}", stat.S_IFREG),
            ("data.txt", b"data", stat.S_IFREG),
        ]
    )
    path = tmp_path / "input.zip"
    path.write_bytes(payload)
    from agent_mc_autonomy.runtime_bundle import download

    monkeypatch.setattr(
        download,
        "verify_bundle",
        lambda *a, **kw: pytest.fail("full verifier before pinned manifest"),
    )
    with pytest.raises(BundleError, match="manifest"):
        unpack_archive(path, tmp_path / "stage", spec(payload, expanded_bytes=6))


def test_valid_archive_runs_existing_full_verifier(tmp_path, monkeypatch):
    payload = archive(
        [
            ("runtime-manifest.json", b"{}", stat.S_IFREG),
            ("data.txt", b"data", stat.S_IFREG),
        ]
    )
    path = tmp_path / "input.zip"
    path.write_bytes(payload)
    from agent_mc_autonomy.runtime_bundle import download

    calls = []
    monkeypatch.setattr(
        download, "verify_bundle", lambda root, **kw: calls.append((root, kw))
    )
    dest = tmp_path / "stage"
    unpack_archive(
        path,
        dest,
        spec(
            payload, expanded_bytes=6, manifest_sha256=hashlib.sha256(b"{}").hexdigest()
        ),
    )
    assert (dest / "data.txt").read_bytes() == b"data"
    assert calls == [
        (dest, {"expected_manifest_sha256": hashlib.sha256(b"{}").hexdigest()})
    ]
