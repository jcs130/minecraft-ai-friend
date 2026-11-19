"""Import server-installed TLM sound packs into the shared TTS catalog, once per sound pack.
Input archives are read in place. Original recordings and generated voice profiles stay on the server.
"""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
from urllib import error, request
import wave
from zipfile import ZipFile

PACK = re.compile(r"assets/([a-z0-9_.-]{1,80})/maid_sound\.json\Z")
VOICE = re.compile(r"[A-Za-z0-9_.-]{1,96}\Z")
LIMIT = 16 * 1024 * 1024
API = "http://127.0.0.1:8017/v1/audio/voices"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_request(url, data=None):
    req = request.Request(url, data=None if data is None else json.dumps(data).encode(),
                          headers={"Content-Type": "application/json"})
    # Local media only. Never send recordings through a system HTTP proxy.
    with request.build_opener(request.ProxyHandler({})).open(req, timeout=40) as reply:
        return json.load(reply)


def safe_relative(name):
    path = PurePosixPath(name)
    return not path.is_absolute() and ".." not in path.parts and "\\" not in name and ":" not in name


def sources(roots):
    for root in roots:
        root = root.resolve(strict=True)
        if root.is_file():
            yield root
        else:
            if (root / "assets").is_dir():
                yield root
            else:
                for path in sorted(root.iterdir()):
                    if path.suffix.lower() == ".zip" or path.is_dir() and (path / "assets").is_dir():
                        yield path


def entries(source):
    if source.is_file():
        with ZipFile(source) as archive:
            items = {}
            for info in archive.infolist():
                name = info.filename
                if not (PACK.fullmatch(name) or name.endswith(".ogg") and "/sounds/maid/" in name):
                    continue
                if name in items or not safe_relative(name) or info.file_size > LIMIT:
                    raise ValueError("Invalid or ambiguous pack entry: " + name)
                items[name] = info
            yield items.keys(), lambda name: archive.read(items[name])
    else:
        paths = {}
        for manifest in (source / "assets").glob("*/maid_sound.json"):
            directory = manifest.parent / "sounds/maid"
            for path in [manifest, *directory.rglob("*.ogg")]:
                if not path.resolve().is_relative_to(source) or path.stat().st_size > LIMIT:
                    raise ValueError("Invalid local pack entry")
                paths[path.relative_to(source).as_posix()] = path
        yield paths.keys(), lambda name: paths[name].read_bytes()


def decode_clip(ffmpeg, blob):
    p = subprocess.run([ffmpeg, "-nostdin", "-loglevel", "error", "-protocol_whitelist", "pipe",
                        "-i", "pipe:0", "-t", "16", "-ac", "1", "-ar", "24000", "-f", "s16le", "pipe:1"],
                       input=blob, capture_output=True, check=True, timeout=15)
    return p.stdout


def as_wav(pcm):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
        wav.writeframes(pcm)
    return buf.getvalue()


class LocalTranscripts:
    def __init__(self, directory):
        self.directory = directory
        self.model = None

    def __call__(self, pcm):
        if self.directory is None:
            return None
        import numpy as np
        import sherpa_onnx
        if self.model is None:
            self.model = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=str(self.directory / "model.int8.onnx"), tokens=str(self.directory / "tokens.txt"),
                language="auto", use_itn=True, num_threads=2, provider="cpu")
        stream = self.model.create_stream()
        stream.accept_waveform(24000, np.frombuffer(pcm, dtype="<i2").astype("float32") / 32768)
        self.model.decode_stream(stream)
        result = stream.result
        text = result.text.strip()
        if result.event != "<|Speech|>" or result.lang not in {"<|zh|>", "<|en|>", "<|ja|>", "<|ko|>", "<|yue|>"}:
            return None
        return text if 4 <= sum(c.isalnum() for c in text) and len(text) <= 400 else None


def reference(pack, meta, names, read, ffmpeg, transcribe):
    prefix = f"assets/{pack}/"
    clips = [n for n in names if n.startswith(prefix + "sounds/maid/") and n.endswith(".ogg")]
    authored = meta.get("tts_reference")
    if authored is not None:
        name = prefix + authored["file"]
        text = authored["text"].strip()
        if name not in clips or not safe_relative(name) or not text or len(text) > 400:
            raise ValueError("Invalid authored TTS reference: " + pack)
        pcm = decode_clip(ffmpeg, read(name))
        if not 0.25 <= len(pcm) / 48000 < 15.95:
            raise ValueError("Authored reference must be a complete clip under 16 seconds")
        return name, as_wav(pcm), text, "pack"
    # Prefer complete spoken lines. Never make a voice out of combat grunts or music.
    eligible = [n for n in clips if re.search(r"/(idle|morning|night|afternoon|evening|rain|snow|hot|cold|greeting|welcome|return|goodnight|daytime|meal|lunch|dinner)[_/\d.]", n, re.I)]
    eligible.sort(key=lambda n: (not re.search(r"/(idle|morning|night)", n, re.I), n))
    best = None
    for name in eligible[:32]:
        pcm = decode_clip(ffmpeg, read(name))
        seconds = len(pcm) / 48000
        if not 1.2 <= seconds < 15.95:
            continue
        rank = abs(seconds - 6)
        if best is not None and rank >= best[0]:
            continue
        text = transcribe(pcm)
        if text:
            best = (rank, name, pcm, text)
            if rank < 1: break
    if best:
        return best[1], as_wav(best[2]), best[3], "local-asr"
    return None


def atomic_json(path, data):
    data = (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode()
    if path.exists() and path.read_bytes() == data:
        return
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        name = Path(f.name)
        try:
            f.write(data); f.flush(); os.fsync(f.fileno())
        except BaseException:
            f.close(); name.unlink(missing_ok=True); raise
    try:
        os.replace(name, path)
    finally:
        name.unlink(missing_ok=True)


def sync(roots, aliases, encoder, transcribe, publish, endpoint=API):
    known = {r["id"] for r in json_request(endpoint)["catalog"]}
    packs, evidence, seen = {}, [], set()
    for source in sources(roots):
        source_hash = None
        for names, read in entries(source):
            for manifest in sorted(n for n in names if PACK.fullmatch(n)):
                pack = PACK.fullmatch(manifest).group(1)
                if pack in seen:
                    raise ValueError("Two sources declare the same sound pack: " + pack)
                seen.add(pack)
                meta = json.loads(read(manifest).decode("utf-8-sig"))
                alias = aliases.get(pack)
                if alias and source.is_file():
                    if source_hash is None:
                        with source.open("rb") as f: source_hash = hashlib.file_digest(f, "sha256").hexdigest()
                    if source_hash == alias["archiveSha256"] and alias["voice"] in known:
                        details = json_request(endpoint + "/" + alias["voice"])
                        if details.get("reference_sha256") != alias["referenceSha256"]:
                            raise ValueError("Existing voice reference changed: " + pack)
                        packs[pack] = alias["voice"]
                        evidence.append(dict(pack=pack,voice=packs[pack],origin="verified-existing"))
                        continue
                ref = reference(pack, meta, names, read, str(encoder), transcribe)
                if not ref:
                    evidence.append(dict(pack=pack,origin="no-spoken-reference"));continue
                entry, audio, words, origin = ref
                signature = digest(audio + b"\x00" + words.encode())
                voice = "tlm-" + pack[:62] + "-" + signature[:24]
                if not VOICE.fullmatch(voice):
                    raise ValueError("Invalid generated voice ID")
                authors = meta.get("author", [])
                if not isinstance(authors, list): authors=[str(authors)]
                credit = ", ".join(str(s) for s in authors)[:150]
                description = "TLM " + pack + " · " + credit + " · " + signature
                if publish:
                    if voice not in known:
                        try:
                            json_request(endpoint, dict(id=voice, label=pack, description=description,
                                reference_text=words, reference_audio=base64.b64encode(audio).decode()))
                        except error.HTTPError as conflict:
                            if conflict.code != 409: raise
                    details = json_request(endpoint + "/" + voice)
                    # The uploaded sample is already mono PCM16 WAV at the service's native 24 kHz.
                    if (details.get("reference_text") != words or details.get("description") != description
                            or details.get("reference_sha256") != digest(audio)):
                        raise ValueError("Existing voice does not match the source: " + pack)
                packs[pack] = voice
                evidence.append(dict(pack=pack,voice=voice,source=source.name,entry=entry,reference=digest(audio),
                                     signature=signature,origin=origin,credit=credit))
    return dict(schema=2, scope="player_owned", nativeEncoder=str(encoder.resolve()), packs=dict(sorted(packs.items()))), evidence


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("sources", type=Path, nargs="+")
    p.add_argument("--aliases", type=Path, help="verified legacy TTS voices and matching archive/reference SHA256")
    p.add_argument("--encoder", required=True, type=Path)
    p.add_argument("--asr", type=Path, help="optional local multilingual SenseVoice model directory")
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--report", type=Path, required=True)
    p.add_argument("--publish", action="store_true", help="register missing voices and write the runtime catalog")
    args = p.parse_args()
    if not args.encoder.is_file(): p.error("Encoder was not found")
    aliases = json.loads(args.aliases.read_text("utf-8-sig")) if args.aliases else {}
    cfg, report = sync(args.sources, aliases, args.encoder, LocalTranscripts(args.asr), args.publish)
    if not cfg["packs"]: raise ValueError("No usable voices; preserving the existing catalog")
    atomic_json(args.report, {"published": args.publish, "packs":report})
    if args.publish: atomic_json(args.output, cfg)
    print(f"{len(cfg['packs'])}/{len(report)} sound packs ready")

if __name__ == "__main__":
    main()
