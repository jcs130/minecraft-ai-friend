"""Patch companion identity matching and lifecycle logs onto the audited API JAR."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

BASE_SHA256 = "4b36f166b3f7c7f380a297c24a1f8bcd0fe9836ea0365c2da5993bc33792b313"
ROOTS = {"entity/Companions", "entity/CompanionRoster"}


def allowed(name):
    prefix = "com/dwinovo/numen/api/"
    return name.startswith(prefix) and name.endswith(".class") and name[len(prefix):-6] in ROOTS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("baseline", "compiled", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.baseline.read_bytes()).hexdigest() != BASE_SHA256:
        raise ValueError("baseline is not the audited production API")
    if args.output.exists():
        raise FileExistsError(args.output)
    with zipfile.ZipFile(args.baseline) as base, zipfile.ZipFile(args.compiled) as compiled:
        old = {row.filename: base.read(row.filename) for row in base.infolist()}
        patch = {row.filename: compiled.read(row.filename) for row in compiled.infolist() if allowed(row.filename)}
        assert len(old) == len(base.infolist())
        assert len(compiled.namelist()) == len(set(compiled.namelist()))
        assert all("com/dwinovo/numen/api/" + root + ".class" in patch for root in ROOTS)
        assert not any(name.upper().endswith((".SF", ".RSA", ".DSA")) for name in old)
        assert not any(allowed(name) and name not in patch for name in old)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED) as output:
            for row in base.infolist():
                output.writestr(row, patch.get(row.filename, old[row.filename]))
            for name in sorted(patch.keys() - old.keys()):
                output.writestr(name, patch[name])
    with zipfile.ZipFile(args.output) as output:
        assert all(output.read(name) == data for name, data in old.items() if not allowed(name))
        assert all(output.read(name) == data for name, data in patch.items())
    summary = {
        "baselineSha256": BASE_SHA256,
        "candidateSha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
        "changedClasses": sorted(name for name in old.keys() & patch.keys() if old[name] != patch[name]),
        "addedClasses": sorted(patch.keys() - old.keys()),
        "unchangedEntries": sum(old[name] == patch.get(name, old[name]) for name in old),
    }
    args.output.with_suffix(".assembly.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
