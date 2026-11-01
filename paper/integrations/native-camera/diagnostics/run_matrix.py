"""Bounded shader-off/on runs in an explicitly marked, standalone Windows lab."""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

from windows_metrics import Windows

GIB = 1024**3
HERE = Path(__file__).resolve().parent


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def properties(original, enabled, shader):
    lines = original.decode("utf-8-sig").splitlines()
    lines = [line for line in lines if not re.match(r"\s*(enableShaders|shaderPack)\s*[=:]", line)]
    return ("\n".join(lines) + f"\nenableShaders={str(enabled).lower()}\nshaderPack={shader}\n").encode("utf-8")


def validate(game, manifest, out, fixture_port):
    marker = json.loads((game / "memory-lab.json").read_text(encoding="utf-8-sig"))
    if marker != {"schema": "qiandeng-camera-memory-lab/v1", "isolated": True, "loopbackOnly": True}:
        raise ValueError("Use a separately provisioned lab with the documented memory-lab.json marker")
    if out.is_relative_to(game) or game.is_relative_to(out) or out.exists():
        raise ValueError("Use a new output directory outside the client")
    args = manifest["arguments"]
    if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
        raise ValueError("Invalid launch arguments")
    forbidden = {"--server", "--port", "--quickPlayMultiplayer", "--quickPlaySingleplayer", "--quickPlayRealms"}
    if any(arg.split("=", 1)[0] in forbidden for arg in args):
        raise ValueError("Remove autojoin arguments from the lab manifest; use only --fixture-port here")
    if any(arg.startswith(("-javaagent:", "-agentlib:", "-agentpath:", "-XX:NativeMemoryTracking")) for arg in args):
        raise ValueError("Unreviewed agent or NMT options already present")
    for key in ("--gameDir", "--assetsDir"):
        if key not in args or Path(args[args.index(key)+1]).resolve() != game / ("assets" if key == "--assetsDir" else ""):
            raise ValueError(f"Lab {key} must point inside its own instance")
    if "--accessToken" not in args or args[args.index("--accessToken")+1] != "0":
        raise ValueError("Use the lab's unverified offline identity, never copy production authentication")
    if fixture_port is not None and not 1024 <= fixture_port <= 65535:
        raise ValueError("Invalid isolated loopback fixture port")
    return args


def launch_arguments(arguments, agent, output, heap_mib, port, game, micro=None):
    args = [arg for arg in arguments if not arg.startswith(("-Xms", "-Xmx"))]
    if micro:
        if "-cp" not in args: raise ValueError("Expected the provisioned lab's -cp launch argument")
        cp=args[args.index("-cp")+1]
        args=[arg for arg in args if arg.startswith(("-Djava.library.path=","-Dorg.lwjgl.librarypath="))]
        args += [f"-Dqiandeng.memory.repro.mode={micro}", "-cp", str(agent)+os.pathsep+cp, "org.qiandeng.diagnostics.GlRepro"]
    # Public launch.py remains unchanged/resident. This runner is a separate QA
    # process; it never invokes the production launcher or installs a mod.
    jvm = [f"-Xms256M", f"-Xmx{heap_mib}M", "-XX:NativeMemoryTracking=summary",
           "-XX:+UnlockDiagnosticVMOptions", "-XX:+PrintNMTStatistics",
           f"-XX:ErrorFile={output / 'hs_err_pid%p.log'}", f"-javaagent:{agent}={output}"]
    display_path = game / "native-camera-display.json"
    if display_path.exists():
        display = json.loads(display_path.read_text(encoding="utf-8-sig"))
        if display.get("schema") != 1 or display.get("expectedGpu") != "Intel" or display.get("graphicsBackend") != "mesa-d3d12":
            raise ValueError("Expected the existing application-local Intel D3D12 lab display profile")
        for key in ("windowX", "windowY"):
            if type(display.get(key)) is not int or not -32768 <= display[key] <= 32767:
                raise ValueError("Invalid lab display coordinates")
            jvm.append(f"-Dqiandeng.camera.{key}={display[key]}")
    jvm += ["-Dqiandeng.camera.enabled=true", "-Dqiandeng.camera.hidden=false"]
    if port is not None and not micro:
        args += ["--quickPlayMultiplayer", f"127.0.0.1:{port}"]
    return jvm + args


def checkpoint(jcmd, process, root, label, baseline=False, final=False):
    baseline=not (root/"nmt-baseline.ok").exists()
    commands = [("nmt", ["VM.native_memory", "summary" if baseline else "summary.diff", "scale=KB"])]
    if baseline: commands += [("baseline",["VM.native_memory","baseline"])]
    commands += [("heap", ["GC.heap_info"])]
    if final:
        commands += [("threads", ["Thread.print", "-l"])]
    for name, command in commands:
        try:
            value = subprocess.run([str(jcmd), str(process.pid), *command], capture_output=True, timeout=2,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            (root / f"{label}-{name}.txt").write_bytes(value.stdout + value.stderr)
            if name=="baseline" and value.returncode==0 and b"Baseline succeeded" in value.stdout:
                (root/"nmt-baseline.ok").write_text(label,encoding="utf-8")
        except (subprocess.TimeoutExpired, OSError) as failure:
            (root / f"{label}-{name}.txt").write_text(type(failure).__name__, encoding="utf-8")


def run_case(args, windows, game, java, agent, launch, output, enabled, traced, micro=None):
    output.mkdir()
    mode = "micro-"+micro if micro else "shader-on" if enabled else "shader-off"
    started = time.monotonic()
    receipt = {"schema": "camera-memory-lab-run/v1", "mode": mode, "mesaResourceTrace": traced=="res", "traceKind":traced or "none",
               "verified": False, "purpose": "diagnostic-only", "durationRequested": args.seconds,
               "processLimitBytes": int(args.process_limit_gib*GIB), "heapMiB": args.heap_mib,
               "shaderSha256": digest(game / "shaderpacks" / args.shader), "agentSha256": digest(agent),
               "probeHelperSha256": digest(agent.with_name("camera-memory-probe.jar")),
               "inputSha256": {str(path.relative_to(game)):digest(path) for path in
                   [game/"launch.json",game/"options.txt",game/"config/iris.properties",*sorted((game/"mods").glob("*.jar"))] if path.is_file()}}
    env = os.environ.copy()
    for name in ("JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS"):
        if env.get(name):
            raise ValueError(f"Unset process-local {name} for a reproducible lab run")
    env["MESA_D3D12_DEFAULT_ADAPTER_NAME"] = "Intel"
    if env.get("D3D12_DEBUG"):
        raise ValueError("Unset inherited D3D12_DEBUG; resource tracing is a separately labelled arm")
    if any(env.get(key) for key in ("GALLIUM_TRACE","GALLIUM_TRACE_TC","GALLIUM_TRACE_TRIGGER")):
        raise ValueError("Unset inherited Gallium tracing; each tracing arm must be labelled")
    if traced=="res":
        env["D3D12_DEBUG"] = "res"
    elif traced=="gallium":
        env["GALLIUM_TRACE"]=str(output/"gallium.xml")
        env["GALLIUM_TRACE_TC"]="0"
    if windows.host()["hostFreeCommit"] < args.min_host_free_gib*GIB + args.process_limit_gib*GIB:
        raise RuntimeError("Host commit headroom preflight failed; no client launched")
    process = gpu = None; job = None
    stop = "not-started"; modules = {}
    pool = ThreadPoolExecutor(max_workers=1)
    future = None
    try:
        with (output / "client.log").open("xb") as log, (output / "process.jsonl").open("x", encoding="utf-8") as samples:
            process = subprocess.Popen([str(java), *launch_arguments(launch, agent, output, args.heap_mib, args.fixture_port, game, micro)],
                cwd=game, env=env, stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
            receipt.update(pid=process.pid, startedAtMs=int(time.time()*1000))
            # Only this freshly spawned child is assigned. If nesting is denied,
            # kill our own child and fail; never proceed without the hard cap.
            job = windows.contain(process, int(args.process_limit_gib*GIB))
            write_json(output / "run.json", receipt)
            with (output / "gpu.jsonl").open("xb") as gpu_log:
                gpu = subprocess.Popen(["powershell.exe", "-NoProfile", "-NonInteractive", "-File", str(HERE / "gpu-counters.ps1"), "-TargetPid", str(process.pid)],
                    stdout=gpu_log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
                next_checkpoint = 0; next_modules = 0; triggered = False
                while process.poll() is None:
                    elapsed = time.monotonic()-started
                    try:
                        row = {"atMs": int(time.time()*1000), "pid": process.pid, "elapsedSeconds": elapsed, **windows.process(process)}
                    except OSError as failure:
                        receipt["processCounterError"]=type(failure).__name__
                        stop="client-exited" if process.poll() is not None else "process-counters-unavailable"
                        break
                    samples.write(json.dumps(row)+"\n"); samples.flush()
                    if elapsed >= args.seconds: stop="duration-limit"; break
                    if row["privateBytes"] >= (args.process_limit_gib-0.5)*GIB: stop="private-memory-guard"; break
                    if row["hostFreeCommit"] < args.min_host_free_gib*GIB: stop="host-commit-guard"; break
                    if sum(path.stat().st_size for path in (output/"client.log",output/"gallium.xml") if path.is_file()) >= 64*1024*1024:
                        stop="log-size-guard"; break
                    if row["privateBytes"] >= 3*GIB and not triggered and (future is None or future.done()):
                        triggered = True
                        future = pool.submit(checkpoint, java.with_name("jcmd.exe"), process, output, "growth-trigger", False, True)
                    elif elapsed >= max(1, next_checkpoint) and (future is None or future.done()):
                        future = pool.submit(checkpoint, java.with_name("jcmd.exe"), process, output,
                            f"{int(elapsed*1000):08d}", next_checkpoint == 0)
                        next_checkpoint = elapsed + 3
                    if elapsed >= next_modules:
                        try: module_paths=windows.modules(process)
                        except OSError as failure:
                            receipt["moduleEnumerationError"]=type(failure).__name__;module_paths=[]
                        for path in module_paths:
                            file = Path(path)
                            if file.name.lower().startswith(("opengl", "d3d12", "dxil", "ig", "gallium", "lwjgl")) and path not in modules:
                                try: modules[path] = digest(file)
                                except OSError: modules[path] = "unavailable"
                        next_modules = elapsed + 3
                    time.sleep(0.25)
                if process.poll() is not None: stop="client-exited"
    finally:
        # Parent never looks up/terminates arbitrary PIDs or shared executables.
        if process is not None and process.poll() is None:
            process.terminate()
            try: process.wait(timeout=3)
            except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=3)
        if gpu is not None and gpu.poll() is None:
            gpu.terminate()
            try: gpu.wait(timeout=3)
            except subprocess.TimeoutExpired: gpu.kill(); gpu.wait(timeout=3)
        if job: windows.kernel.CloseHandle(job)
        pool.shutdown(wait=True, cancel_futures=True)
        receipt.update(stopReason=stop, elapsedSeconds=time.monotonic()-started,
                       exitCode=None if process is None else process.returncode, loadedModuleSha256=modules,
                       boundedQaTermination=True, normalGameExitVerified=False)
        write_json(output / "run.json", receipt)
    return receipt


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--game", required=True, type=Path); p.add_argument("--java", required=True, type=Path)
    p.add_argument("--agent", required=True, type=Path); p.add_argument("--out", required=True, type=Path)
    p.add_argument("--shader", required=True, help="Existing shader ZIP basename in this lab")
    p.add_argument("--fixture-port", type=int, help="Already running, isolated loopback server; this tool starts no server")
    p.add_argument("--seconds", type=int, default=45)
    p.add_argument("--heap-mib", type=int, default=1536)
    p.add_argument("--process-limit-gib", type=float, default=6)
    p.add_argument("--min-host-free-gib", type=float, default=8)
    p.add_argument("--mesa-resource-trace", action="store_true", help="Add separately labelled res-logging off/on arms; no debug layer")
    p.add_argument("--gallium-trace", action="store_true", help="Add separately labelled driver-thread XML trace arms, bounded by log guard")
    p.add_argument("--microprobes", nargs="*", default=[], choices=["steady","depth-copy","buffer-orphan","buffer-update","program-churn"],
                   help="Additional minimal actual-GL arms without Minecraft/Iris/YSM")
    p.add_argument("--micro-only", action="store_true", help="Run only the selected microprobes, never launch Minecraft")
    args = p.parse_args()
    if not 5 <= args.seconds <= 180 or not 512 <= args.heap_mib <= 2048 or not 4 <= args.process_limit_gib <= 8 or args.min_host_free_gib < 8:
        p.error("QA bounds: 5..180s, 512..2048MiB heap, 4..8GiB private cap, >=8GiB host margin")
    game, java, agent, out = (value.resolve() for value in (args.game,args.java,args.agent,args.out))
    if Path(args.shader).name != args.shader or not args.shader.lower().endswith(".zip") or not (game/"shaderpacks"/args.shader).is_file():
        p.error("Select an existing shader ZIP basename")
    if not java.is_file() or not java.with_name("jcmd.exe").is_file() or not agent.is_file() or not agent.with_name("camera-memory-probe.jar").is_file():
        p.error("Dedicated JDK21 java/jcmd and built observer required")
    if args.micro_only and not args.microprobes: p.error("--micro-only requires selected --microprobes")
    launch = validate(game, json.loads((game/"launch.json").read_text(encoding="utf-8-sig")), out, args.fixture_port)
    windows = Windows()  # fail before mutations on non-Windows
    prop = game/"config/iris.properties"; original = prop.read_bytes()
    out.mkdir(parents=True)
    try:
        traces=[None]+(["res"] if args.mesa_resource_trace else [])+(["gallium"] if args.gallium_trace else [])
        for traced in ([] if args.micro_only else traces):
            for enabled in (False,True):
                # Restore even after a failed child; do not preserve an enabled
                # shader setting as a side effect of diagnostics.
                prop.write_bytes(properties(original, enabled, args.shader))
                folder = out / (("mesa-"+traced+"-" if traced else "") + ("shader-on" if enabled else "shader-off"))
                run_case(args, windows, game, java, agent, launch, folder, enabled, traced)
        prop.write_bytes(original)
        for mode in args.microprobes:
            run_case(args, windows, game, java, agent, launch, out/("micro-"+mode), False, False, mode)
    finally:
        prop.write_bytes(original)
        write_json(out/"restoration.json", {"irisPropertiesRestored": prop.read_bytes() == original,
            "productionRendererChanged": False, "globalGraphicsSettingsChanged": False})
    subprocess.run([str(Path(os.sys.executable)), str(HERE/"analyze.py"), str(out)], check=True)


if __name__ == "__main__":
    main()
