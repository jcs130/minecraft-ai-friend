"""Build an item-scoped air interaction fix on the observed qd29 JAR."""
import argparse
from copy import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


BASE_SHA256 = "e92ed8e47a99f364f96943c3843933933e20b1ec00f5d8ed1706cd8f8e69a20c"
HANDLER = "io/vortexcore/item/CustomItemRuntimeService.class"
GUARD = "io/vortexcore/item/StaffAirInput.class"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("base", "jdk", "asm", "api", "output"):
        parser.add_argument("--" + name, required=True, type=Path)
    args = parser.parse_args()
    report = args.output.with_suffix(".json")
    if args.output.exists() or report.exists():
        parser.error("output and report must be new paths")
    if sha256(args.base) != BASE_SHA256:
        parser.error("unsupported VortexRPG SHA256")

    sources = Path(__file__).resolve().parent / "staff-clicks"
    java, javac = (args.jdk / "bin" / executable for executable in ("java", "javac"))
    with TemporaryDirectory(prefix="qd-staff-clicks-", dir=args.output.parent) as directory, ZipFile(args.base) as original:
        work = Path(directory)
        classpath = os.pathsep.join(map(str, (args.asm, args.api, args.base)))
        subprocess.run([javac, "-proc:none", "-encoding", "UTF-8", "-cp", classpath, "-d", work,
                        sources / "PatchStaffClicks.java", sources / "StaffAirInput.java"], check=True)
        old_handler = work / "stock.class"
        old_handler.write_bytes(original.read(HANDLER))
        replacement = work / "patched.class"
        subprocess.run([java, "-cp", os.pathsep.join(map(str, (work, args.asm))),
                        "PatchStaffClicks", old_handler, replacement], check=True)
        candidate = work / "candidate.jar"
        with ZipFile(candidate, "x", compression=ZIP_DEFLATED) as result:
            for entry in original.infolist():
                content = replacement.read_bytes() if entry.filename == HANDLER else original.read(entry)
                result.writestr(copy(entry), content)
            result.writestr(ZipInfo(GUARD), (work / GUARD).read_bytes(), compress_type=ZIP_DEFLATED)
        with ZipFile(candidate) as result:
            assert set(result.namelist()) - set(original.namelist()) == {GUARD}
            assert [name for name in original.namelist() if original.read(name) != result.read(name)] == [HANDLER]
        candidate.rename(args.output)
    report.write_text(json.dumps({"baseSha256": BASE_SHA256, "sha256": sha256(args.output),
                                  "changedEntries": [HANDLER], "addedEntries": [GUARD]}, indent=2) + "\n",
                      encoding="utf-8")


if __name__ == "__main__":
    main()
