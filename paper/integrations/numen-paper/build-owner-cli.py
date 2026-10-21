"""Build the owner CLI and shared-key policy candidate on the audited production API."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

BASE_SHA256 = "3ccb46aadf19b425392b9a0f197b546a4d51a86e000a18bf097024121c3be33f"
ROOTS = {"brain/OwnerCommands", "brain/ModelServices", "brain/Libraries", "config/ServerSettings",
         "keys/Keys", "agent/llm/ProviderLibrary", "entity/NumenCommands"}


def allowed(name):
    prefix = "com/dwinovo/numen/api/"
    return name.startswith(prefix) and name.endswith(".class") and name[len(prefix):-6].split("$", 1)[0] in ROOTS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--compiled", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.baseline.read_bytes()).hexdigest() != BASE_SHA256:
        raise ValueError("baseline is not the audited production API")
    if args.output.exists():
        raise FileExistsError(args.output)
    with zipfile.ZipFile(args.baseline) as base, zipfile.ZipFile(args.compiled) as compiled:
        old = {n: base.read(n) for n in base.namelist()}
        patch = {n: compiled.read(n) for n in compiled.namelist() if allowed(n)}
        assert len(old) == len(base.infolist()) and len(set(compiled.namelist())) == len(compiled.infolist()), "duplicate ZIP entries"
        assert all("com/dwinovo/numen/api/" + root + ".class" in patch for root in ROOTS), "missing compiled class"
        assert not any(n.upper().endswith((".SF", ".RSA", ".DSA")) for n in old), "signed baseline"
        assert not any(allowed(n) and n not in patch for n in old), "stale nested class"
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED) as out:
            for entry in base.infolist():
                out.writestr(entry, patch.get(entry.filename, old[entry.filename]))
            for name in sorted(patch.keys() - old.keys()):
                out.writestr(name, patch[name])
    with zipfile.ZipFile(args.output) as out:
        assert all(out.read(n) == content for n, content in old.items() if not allowed(n))
        assert all(out.read(n) == content for n, content in patch.items())
    summary = {"baselineSha256": BASE_SHA256, "candidateSha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
               "changedClasses": sorted(n for n in old.keys() & patch.keys() if old[n] != patch[n]),
               "addedClasses": sorted(patch.keys() - old.keys()),
               "unchangedEntries": sum(old[n] == patch.get(n, old[n]) for n in old)}
    args.output.with_suffix(".assembly.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
