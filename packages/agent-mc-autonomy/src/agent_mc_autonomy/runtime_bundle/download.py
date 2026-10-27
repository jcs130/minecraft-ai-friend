"""Explicit, pinned public runtime preparation; never start a game or a model."""

from __future__ import annotations

import hashlib
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx

from ..filesystem import verification_path
from ..ownership import session_lease
from . import PreparedBundle, resolve_prepared_bundle
from .manifest import MANIFEST, digest, fail, relative_path, verify_bundle

HOSTS = frozenset(
    {
        "github.com",
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
        "github-releases.githubusercontent.com",
    }
)
MAX_ARCHIVE = 2 * 1024**3
MAX_EXPANDED = 8 * 1024**3


def _url(value: str, *, initial: bool = False) -> str:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except (TypeError, ValueError):
        fail("download_url_invalid")
    if (
        parsed.scheme != "https"
        or parsed.hostname not in ({"github.com"} if initial else HOSTS)
        or parsed.username
        or parsed.password
        or port not in {None, 443}
        or parsed.fragment
        or initial
        and (
            parsed.query
            or not re.fullmatch(
                r"/[^/]+/[^/]+/releases/download/[^/]+/[^/]+\.zip", parsed.path
            )
        )
    ):
        fail("download_redirect_invalid")
    return value


@dataclass(frozen=True)
class ReleaseBundle:
    url: str
    bytes: int
    sha256: str
    manifest_sha256: str
    expanded_bytes: int

    @classmethod
    def parse(cls, value: dict) -> ReleaseBundle:
        keys = {
            "schema",
            "platform",
            "architecture",
            "url",
            "bytes",
            "sha256",
            "manifest_sha256",
            "expanded_bytes",
        }
        if (
            not isinstance(value, dict)
            or set(value) != keys
            or value["schema"] != "agent-mc-runtime-download/v1"
            or value["platform"] != "win32"
            or value["architecture"] != "x64"
            or type(value["bytes"]) is not int
            or not 1 <= value["bytes"] <= MAX_ARCHIVE
            or type(value["expanded_bytes"]) is not int
            or not 1 <= value["expanded_bytes"] <= MAX_EXPANDED
            or any(
                not isinstance(value[k], str)
                or not re.fullmatch(r"[a-f0-9]{64}", value[k])
                for k in ["sha256", "manifest_sha256"]
            )
        ):
            fail("download_descriptor_invalid")
        return cls(
            _url(value["url"], initial=True),
            value["bytes"],
            value["sha256"],
            value["manifest_sha256"],
            value["expanded_bytes"],
        )


def _cancelled(event) -> None:
    if event is not None and event.is_set():
        fail("download_cancelled")


def _progress(callback, phase: str, **values) -> None:
    if callback:
        callback({"phase": phase, **values})


def _directory(value: Path) -> Path:
    root = Path(value).absolute()
    for path in [*reversed(root.parents), root]:
        selected = verification_path(path)
        if selected.exists():
            info = selected.lstat()
            if (
                not stat.S_ISDIR(info.st_mode)
                or stat.S_ISLNK(info.st_mode)
                or getattr(info, "st_file_attributes", 0) & 0x400
            ):
                fail("download_cache_link_forbidden")
        else:
            selected.mkdir()
    return root


def fetch_archive(
    spec: ReleaseBundle, cache: Path, *, client=None, progress=None, cancelled=None
) -> Path:
    """One bounded download attempt. No credentials or arbitrary user URLs."""
    _cancelled(cancelled)
    root = _directory(cache)
    target = root / (spec.sha256 + ".zip")
    if verification_path(target).exists():
        if verification_path(target).is_symlink():
            fail("download_cache_link_forbidden")
        if (
            verification_path(target).stat().st_size == spec.bytes
            and digest(target) == spec.sha256
        ):
            _progress(
                progress,
                "downloaded",
                downloaded_bytes=spec.bytes,
                total_bytes=spec.bytes,
            )
            return target
        verification_path(target).rename(
            verification_path(root / (".invalid-" + uuid.uuid4().hex))
        )
    temporary = root / (".download-" + uuid.uuid4().hex)
    owned = client is None
    client = client or httpx.Client(
        timeout=httpx.Timeout(15, connect=30), follow_redirects=False
    )
    url, received, sha, started = spec.url, 0, hashlib.sha256(), time.monotonic()
    try:
        _progress(progress, "downloading", downloaded_bytes=0, total_bytes=spec.bytes)
        with verification_path(temporary).open("xb") as output:
            for attempt in range(6):
                _cancelled(cancelled)
                with client.stream(
                    "GET",
                    url,
                    headers={"Accept-Encoding": "identity"},
                    follow_redirects=False,
                ) as response:
                    if response.status_code in {301, 302, 303, 307, 308}:
                        if attempt == 5 or not response.headers.get("location"):
                            fail("download_redirect_invalid")
                        url = _url(urljoin(url, response.headers["location"]))
                        continue
                    if response.status_code != 200:
                        fail("download_http_failed")
                    length = response.headers.get("content-length")
                    if length is not None and length != str(spec.bytes):
                        fail("download_size_mismatch")
                    for chunk in response.iter_bytes(1024 * 1024):
                        _cancelled(cancelled)
                        if time.monotonic() - started > 1800:
                            fail("download_timeout")
                        received += len(chunk)
                        if received > spec.bytes:
                            fail("download_size_mismatch")
                        output.write(chunk)
                        sha.update(chunk)
                        _progress(
                            progress,
                            "downloading",
                            downloaded_bytes=received,
                            total_bytes=spec.bytes,
                        )
                    break
        if received != spec.bytes or sha.hexdigest() != spec.sha256:
            fail("download_hash_or_size_mismatch")
        _cancelled(cancelled)
        verification_path(temporary).replace(verification_path(target))
        _progress(
            progress, "downloaded", downloaded_bytes=received, total_bytes=spec.bytes
        )
        return target
    except httpx.HTTPError:
        fail("download_network_failed")
    finally:
        if owned:
            client.close()
        verification_path(temporary).unlink(missing_ok=True)


def unpack_archive(
    archive: Path,
    destination: Path,
    spec: ReleaseBundle,
    *,
    progress=None,
    cancelled=None,
) -> Path:
    """Validate every ZIP member before extraction, then use the existing full verifier."""
    _cancelled(cancelled)
    if (
        verification_path(archive).stat().st_size != spec.bytes
        or digest(archive) != spec.sha256
    ):
        fail("download_hash_or_size_mismatch")
    if verification_path(destination).exists():
        fail("download_stage_exists")
    try:
        with zipfile.ZipFile(verification_path(archive)) as source:
            rows = source.infolist()
            if not 1 <= len(rows) <= 100000:
                fail("download_archive_limits")
            names, regular, total = set(), set(), 0
            for row in rows:
                name = relative_path(row.filename.removesuffix("/"))
                mode = stat.S_IFMT(row.external_attr >> 16)
                key = name.casefold()
                if (
                    key in names
                    or mode not in {0, stat.S_IFREG, stat.S_IFDIR}
                    or row.flag_bits & 1
                ):
                    fail("download_archive_member_invalid")
                if (
                    row.is_dir()
                    and mode == stat.S_IFREG
                    or not row.is_dir()
                    and mode == stat.S_IFDIR
                ):
                    fail("download_archive_member_invalid")
                names.add(key)
                if not row.is_dir():
                    regular.add(key)
                if row.file_size > 512 * 1024**2:
                    fail("download_archive_limits")
                total += row.file_size
            if total != spec.expanded_bytes or total > MAX_EXPANDED:
                fail("download_archive_limits")
            if any(
                parent.as_posix().casefold() in regular
                for name in names
                for parent in Path(name).parents
                if parent.as_posix() != "."
            ):
                fail("download_archive_path_collision")
            _directory(destination)
            for index, row in enumerate(rows):
                _cancelled(cancelled)
                target = verification_path(destination / row.filename)
                target.parent.mkdir(parents=True, exist_ok=True)
                if row.is_dir():
                    target.mkdir(exist_ok=True)
                else:
                    with source.open(row) as data, target.open("xb") as output:
                        while chunk := data.read(1024 * 1024):
                            _cancelled(cancelled)
                            output.write(chunk)
                if index % 500 == 0 or index + 1 == len(rows):
                    _progress(
                        progress, "extracting", files=index + 1, total_files=len(rows)
                    )
    except (zipfile.BadZipFile, RuntimeError):
        fail("download_archive_invalid")
    _cancelled(cancelled)
    if digest(destination / MANIFEST) != spec.manifest_sha256:
        fail("download_manifest_mismatch")
    _progress(progress, "verifying")
    verify_bundle(destination, expected_manifest_sha256=spec.manifest_sha256)
    return destination


def _prepare(root: Path, *, cancelled=None) -> None:
    """Only the fully verified bundled Node and preparation script may execute."""
    _cancelled(cancelled)
    env = {
        key: value
        for key, value in os.environ.items()
        if key.upper()
        in {"SYSTEMROOT", "WINDIR", "LOCALAPPDATA", "TEMP", "TMP", "USERPROFILE"}
    }
    command = [str(root / "node/node.exe"), str(root / "prepare.mjs")]
    process = subprocess.Popen(
        command,
        cwd=root,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    started = time.monotonic()
    try:
        while True:
            _cancelled(cancelled)
            if time.monotonic() - started > 600:
                fail("download_preparation_timeout")
            try:
                output, _ = process.communicate(timeout=0.25)
                break
            except subprocess.TimeoutExpired:
                continue
        if process.returncode or len(output) > 16384:
            fail("download_preparation_failed")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def prepare_release(
    spec: ReleaseBundle,
    cache: Path,
    *,
    progress=None,
    cancelled: threading.Event | None = None,
) -> PreparedBundle:
    if sys.platform != "win32" or platform.machine().lower() not in {"amd64", "x86_64"}:
        fail("download_platform_unavailable")
    root = _directory(cache)
    if (
        shutil.disk_usage(root).free
        < spec.bytes + 2 * spec.expanded_bytes + 256 * 1024**2
    ):
        fail("download_disk_space")
    stage = root / (".stage-" + uuid.uuid4().hex)
    with session_lease(root / "preparation-lock"):
        try:
            archive = fetch_archive(spec, root, progress=progress, cancelled=cancelled)
            unpack_archive(archive, stage, spec, progress=progress, cancelled=cancelled)
            _progress(progress, "installing")
            _prepare(stage, cancelled=cancelled)
            _cancelled(cancelled)
            bundle = resolve_prepared_bundle(bundle_root=stage, verify_integrity=True)
            if bundle.manifest_sha256 != spec.manifest_sha256:
                fail("download_manifest_mismatch")
            return bundle
        finally:
            # Remove only this newly owned extraction tree inside the checked cache.
            if (
                verification_path(stage).exists()
                and stage.parent.resolve() == root.resolve()
                and re.fullmatch(r"\.stage-[a-f0-9]{32}", stage.name)
            ):
                shutil.rmtree(verification_path(stage))
