"""Build the distributable using the official N.E.K.O. SDK and reproducible ZIP metadata."""
import argparse
import os
import sys
import tempfile
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile, ZipInfo


def package(sdk, source, destination):
    sys.path.insert(0, str(sdk.resolve()))
    from plugin.neko_plugin_cli.core import build_plugin

    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        staged = root / "neko_resident"
        for filename in ("__init__.py", "connection.py", "plugin.toml", "pyproject.toml", "ui/panel.tsx"):
            file = staged / filename
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text((source / filename).read_text(encoding="utf-8-sig"), encoding="utf-8", newline="\n")
        (staged / "LICENSE").write_text((source.parents[3] / "LICENSE").read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
        raw = root / "sdk.neko-plugin"
        build_plugin(staged, raw)
        fd, name = tempfile.mkstemp(dir=destination.parent)
        os.close(fd)
        output = Path(name)
        try:
            with ZipFile(raw) as original, ZipFile(output, "w", compression=ZIP_STORED) as archive:
                for entry in sorted(original.namelist()):
                    info = ZipInfo(entry, (1980, 1, 1, 0, 0, 0))
                    info.create_system = 3
                    info.external_attr = 0o100644 << 16
                    archive.writestr(info, original.read(entry))
            output.replace(destination)
        finally:
            output.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--neko-sdk", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    package(args.neko_sdk, Path(__file__).resolve().parent / "neko_resident", args.out)
