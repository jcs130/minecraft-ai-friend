"""Overlay the audited release-protocol classes onto the deployed Numen API, preserving other entries."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

BASE_SHA256 = "6684d9e36d40bcf9a3b651a278fe978c9108f141fbecab8add03701a1496ef2c"
ROOTS = {"brain/CompanionBrains", "brain/CompanionLoop", "brain/Replies", "brain/ReleaseClients",
         "entity/NumenCommands", "network/NumenNetwork", "network/ReleasePackets", "platform/PlayerSessions",
         "platform/PaperNetworkChannel", "platform/PaperReleaseProtocol", "program/ProgramPort", "program/RoutedCalls",
         "program/ServerPrograms", "program/ReleaseModules", "task/CompanionTickDispatcher", "NumenApiPlugin", "PaperEvents"}


def allowed(name):
    prefix = "com/dwinovo/numen/api/"
    return name.startswith(prefix) and name.endswith(".class") and name[len(prefix):-6].split("$", 1)[0] in ROOTS


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--baseline", type=Path, required=True)
    p.add_argument("--compiled", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    if hashlib.sha256(args.baseline.read_bytes()).hexdigest() != BASE_SHA256:
        raise ValueError("baseline is not the audited deployed API")
    if args.output.exists():
        raise FileExistsError(args.output)
    with zipfile.ZipFile(args.baseline) as base, zipfile.ZipFile(args.compiled) as compiled:
        old = {n: base.read(n) for n in base.namelist()}
        patch = {n: compiled.read(n) for n in compiled.namelist() if allowed(n)}
        assert len(old) == len(base.infolist()) and len(set(compiled.namelist())) == len(compiled.infolist()), "duplicate ZIP entries"
        assert all(any(n == "com/dwinovo/numen/api/" + root + ".class" for n in patch) for root in ROOTS), "missing compiled class"
        assert all(not n.upper().endswith((".SF", ".RSA", ".DSA")) for n in old), "signed JAR cannot be overlaid"
        assert not [n for n in old if allowed(n) and n not in patch], "overlay would retain stale nested classes"
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED) as out:
            for entry in base.infolist():
                out.writestr(entry, patch.get(entry.filename, old[entry.filename]))
            for n in sorted(patch.keys() - old.keys()):
                out.writestr(n, patch[n])
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
