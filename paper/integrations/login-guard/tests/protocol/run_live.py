"""Run loopback-only Velocity/Paper protocol probes with synthetic auth and speech.

Requires previously prepared Paper 1.21.1 inputs with an accepted EULA, the pinned
API jars, and compiled baseline/candidate LoginGuard classes. Never deploys.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import zipfile
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
sys.path.insert(0, str(HERE.parent))
from run_transport_tests import PINNED


def wait_for(process, log, marker, seconds=100):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if marker in log.read_text(errors="replace"):
            return
        if process.poll() is not None:
            raise RuntimeError("Process exited: " + str(log))
        time.sleep(0.2)
    raise TimeoutError(str(log))


def stop(process, command):
    if process and process.poll() is None:
        process.stdin.write(command + "\n")
        process.stdin.flush()
        try:
            process.wait(timeout=45)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["inputs", "deps", "classes", "baseline-classes", "node-package", "output"]:
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--proxy-port", type=int, default=25881)
    parser.add_argument("--paper-port", type=int, default=25882)
    args = parser.parse_args()
    out = args.output.resolve()
    if out.exists() or out == REPO or REPO in out.parents:
        parser.error("Use a fresh output directory outside the repository")
    if "eula=true" not in (args.inputs / "eula.txt").read_text():
        parser.error("Supply an already prepared, EULA-accepted isolated Paper runtime")
    deps = [args.deps.resolve() / name for name in PINNED]
    for jar in deps:
        if hashlib.sha256(jar.read_bytes()).hexdigest() != PINNED[jar.name]:
            parser.error("Unreviewed dependency: " + jar.name)
    out.mkdir(parents=True)
    paper = out / "paper"
    paper.mkdir()
    for name in ["libraries", "versions", "cache"]:
        shutil.copytree(args.inputs / name, paper / name)
    for name in ["server.jar", "eula.txt"]:
        shutil.copyfile(args.inputs / name, paper / name)
    (paper / "voice-transport-qa.marker").touch()
    (paper / "plugins").mkdir()
    (paper / "server.properties").write_text(
        f"server-ip=127.0.0.1\nserver-port={args.paper_port}\nonline-mode=false\n"
        "enforce-secure-profile=false\nenable-rcon=false\nenable-query=false\n"
        "max-players=4\nview-distance=2\nsimulation-distance=2\nspawn-protection=0\n"
        "level-name=voice-isolated-world\nlevel-type=minecraft:flat\n"
        'generator-settings={"layers":[{"block":"minecraft:bedrock","height":1},{"block":"minecraft:dirt","height":2},{"block":"minecraft:grass_block","height":1}],"biome":"minecraft:plains"}\n'
        "generate-structures=false\nallow-flight=true\n")
    backend_classes = out / "backend-classes"
    backend_classes.mkdir()
    cp = os.pathsep.join(map(str, [paper / "versions/1.21.1/paper-1.21.1.jar", *paper.glob("libraries/**/*.jar")]))
    subprocess.run(["java", "com.sun.tools.javac.Main", "-proc:none", "-encoding", "UTF-8", "-source", "21", "-target", "21",
                    "-cp", cp, "-d", str(backend_classes), str(HERE / "VoiceBackendProbe.java")], check=True)
    with zipfile.ZipFile(paper / "plugins/VoiceBackendProbe.jar", "w", zipfile.ZIP_DEFLATED) as jar:
        for file in backend_classes.rglob("*.class"):
            jar.write(file, file.relative_to(backend_classes).as_posix())
        jar.writestr("plugin.yml", "name: VoiceBackendProbe\nversion: 0.0.0-test-only\nmain: org.afuhome.auth.VoiceBackendProbe\napi-version: '1.21'\n")
    paper_log = out / "paper.log"
    paper_process = proxy_process = None
    try:
        with paper_log.open("w") as log:
            paper_process = subprocess.Popen(["java", "-Xms256m", "-Xmx768m", "-XX:ActiveProcessorCount=2", "-Dvoice.transport.qa=true",
                "-Dterminal.jline=false", "-Dterminal.ansi=false", "-jar", "server.jar", "--nogui"], cwd=paper, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT, text=True)
        wait_for(paper_process, paper_log, 'Done (')
        print("Isolated Paper ready; no existing world/account data copied", flush=True)
        for label, compiled in [("baseline", args.baseline_classes), ("candidate", args.classes)]:
            proxy = out / label
            (proxy / "plugins").mkdir(parents=True)
            (proxy / "voice-transport-qa.marker").touch()
            (proxy / "velocity.toml").write_text(
                f'config-version = "2.7"\nbind = "127.0.0.1:{args.proxy_port}"\nonline-mode = false\n'
                'force-key-authentication = false\nplayer-info-forwarding-mode = "none"\n'
                f'[servers]\npaper = "127.0.0.1:{args.paper_port}"\ntry = ["paper"]\n'
                '[forced-hosts]\n"lobby.example.com" = ["paper"]\n"factions.example.com" = ["paper"]\n"minigames.example.com" = ["paper"]\n'
                '[advanced]\nlogin-ratelimit = 0\n')
            probe_classes = out / (label + "-probe-classes")
            probe_classes.mkdir()
            cp = os.pathsep.join(map(str, [compiled.resolve(), *deps]))
            subprocess.run(["java", "com.sun.tools.javac.Main", "-proc:none", "-encoding", "UTF-8", "-source", "21", "-target", "21",
                "-cp", cp, "-d", str(probe_classes), str(HERE / "VoiceProxyProbe.java")], check=True)
            with zipfile.ZipFile(proxy / "plugins/VoiceProxyProbe.jar", "w", zipfile.ZIP_DEFLATED) as jar:
                for directory in [compiled, probe_classes]:
                    for file in directory.rglob("*.class"):
                        jar.write(file, file.relative_to(directory).as_posix())
                # Test-only shaded API classes; never start LibreLogin or PacketEvents plugins.
                for dependency in deps[1:]:
                    with zipfile.ZipFile(dependency) as source:
                        for name in source.namelist():
                            if name.endswith(".class") and not name.startswith("META-INF/"):
                                jar.writestr(name, source.read(name))
                jar.writestr("velocity-plugin.json", json.dumps({"id":"voice-protocol-probe","name":"VoiceProtocolProbe","version":"0.0.0-test-only","main":"org.afuhome.auth.VoiceProxyProbe"}))
            proxy_log = out / (label + "-proxy.log")
            with proxy_log.open("w") as log:
                proxy_process = subprocess.Popen(["java", "-Xms128m", "-Xmx256m", "-XX:ActiveProcessorCount=2", "-Dvoice.transport.qa=true",
                    "-Dterminal.jline=false", "-Dterminal.ansi=false", "-jar", str(deps[0])], cwd=proxy, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT, text=True)
            wait_for(proxy_process, proxy_log, "Done (")
            if "VOICE_QA_READY" not in proxy_log.read_text():
                raise RuntimeError("Probe did not initialize")
            env = {**os.environ, "VOICE_QA_PORT":str(args.proxy_port), "VOICE_QA_BASELINE":"1" if label=="baseline" else "0", "VOICE_QA_NODE_PACKAGE":str(args.node_package.resolve())}
            result = subprocess.run(["node", str(HERE / "live_voice.mjs")], env=env, capture_output=True, text=True, timeout=50)
            (out / (label + "-client.log")).write_text(result.stdout + result.stderr)
            print(label + ": " + result.stdout.strip(), flush=True)
            result.check_returncode()
            stop(proxy_process, "shutdown")
            proxy_process = None
        if "player=qa_denied op=" in paper_log.read_text():
            raise AssertionError("Unauthorized request reached Paper")
        print("PASS: denied player sent no request to Paper; baseline and candidate compared over real TCP", flush=True)
    finally:
        stop(proxy_process, "shutdown")
        stop(paper_process, "stop")
    print("Isolated proxy/game processes stopped normally", flush=True)


if __name__ == "__main__":
    main()
