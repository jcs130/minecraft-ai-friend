"""The distributed archive must satisfy the same guard used before game startup."""
import tarfile
from pathlib import Path

from agent_mc_autonomy.core_distribution.install import SOURCE, SOURCE_DIR, verify_archive, verify_runtime


def test_exact_engine_archive_passes_the_real_installation_guard(tmp_path: Path):
    archive = SOURCE_DIR / SOURCE["archive"]
    verify_archive(archive)
    package = tmp_path / "backend/node_modules/agent-mc-world"
    with tarfile.open(archive, "r:gz") as source:
        for member in source.getmembers():
            if not member.isfile():
                continue
            assert member.name.startswith("package/")
            target = (package / member.name.removeprefix("package/")).resolve()
            assert target.is_relative_to(package.resolve())
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.extractfile(member).read())
    assert verify_runtime(tmp_path / "backend") == package / "bin/minecraft-agent-mcp.mjs"
