"""Build only the isolated QA fixture against exact current JAR copies. Never install."""
import argparse
import json
import os
import subprocess
import zipfile
from pathlib import Path

from party4_diagnostics import COMPONENTS, digest, expected_digests, read_json


def build(manifest, server_copy, native, bridge, friend, jdk, output):
    manifest = read_json(manifest)
    inputs = {"native": Path(native), "bridge": Path(bridge), "friend": Path(friend)}
    pins = {key: digest(file.read_bytes()) for key, file in inputs.items()}
    if not all(expected_digests(manifest, name) == [pins[key]] for key, name in COMPONENTS.items()):
        raise ValueError("current_artifact_mismatch: no output created; do not use frozen party4 inputs")
    server_copy, output, jdk = Path(server_copy).resolve(), Path(output).resolve(), Path(jdk)
    if output.exists() or output.is_relative_to(server_copy):
        raise ValueError("fresh_output_outside_server_copy_required")
    source = Path(__file__).resolve().parents[1] / "tests/CooperationFixture.java"
    libraries = sorted(server_copy.glob("libraries/**/*.jar"))
    if not libraries:
        raise ValueError("matching_server_libraries_required")
    output.mkdir(parents=True, exist_ok=False)
    classes = output / "classes"
    classes.mkdir()
    empty = output / "empty-sourcepath"
    empty.mkdir()
    suffix = ".exe" if os.name == "nt" else ""
    args = ["-proc:none", "-implicit:none", "--release", "21", "-encoding", "UTF-8", "-sourcepath", str(empty),
            "-cp", os.pathsep.join(map(str, [*libraries, *inputs.values()])), "-d", str(classes), str(source)]
    argfile = output / "compile.args"
    argfile.write_text("\n".join('"' + arg.replace("\\", "/").replace('"', '\\"') + '"' for arg in args), encoding="utf-8")
    with (output / "compile.log").open("wb") as log:
        subprocess.run([str(jdk / ("bin/javac" + suffix)), "@" + str(argfile)], stdout=log,
                       stderr=subprocess.STDOUT, check=True, timeout=120)
    target = output / "CooperationFixture-0.0.2-party4-qa.jar"
    with zipfile.ZipFile(target, "x", zipfile.ZIP_DEFLATED) as jar:
        jar.writestr("plugin.yml", "name: CooperationFixture\nversion: 0.0.2-party4-qa\nmain: org.qiandengji.vortex.tests.CooperationFixture\napi-version: '1.21'\ndepend: [VortexRPG, QiandengjiRpg, AgentFriend]\n")
        for file in sorted(classes.rglob("*.class")):
            jar.write(file, file.relative_to(classes).as_posix())
    report = {"schema": "party4-fixture-build/v1", "productionChanged": False, "installed": False,
              "baseSha256": pins, "sourceSha256": digest(source.read_bytes()), "file": target.name,
              "sha256": digest(target.read_bytes()), "runtimeVerified": False}
    (output / "build.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("manifest", "server-copy", "native", "bridge", "friend", "jdk", "output"):
        parser.add_argument("--" + field, type=Path, required=True)
    print(json.dumps(build(**vars(parser.parse_args())), indent=2))
