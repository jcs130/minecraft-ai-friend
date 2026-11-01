"""Summarize aligned evidence without declaring a driver leak or production pass."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re
import statistics
from gallium_summary import summarize as gallium_summary


def rows(path):
    result = []
    if path.exists():
        for line in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
            try:
                row = json.loads(line)
                if isinstance(row, dict): result.append(row)
            except ValueError:
                pass  # partial final line and PS errors are not zero measurements
    return result


def slope(samples, field):
    data = [(row["atMs"]/1000, row[field]) for row in samples if isinstance(row.get(field), (int,float))]
    if len(data) < 3 or data[-1][0]-data[0][0] < 2: return None
    origin = data[0][0]
    points = [(x-origin,y) for x,y in data]
    mx, my = statistics.mean(x for x,_ in points), statistics.mean(y for _,y in points)
    denominator = sum((x-mx)**2 for x,_ in points)
    return sum((x-mx)*(y-my) for x,y in points)/denominator if denominator else None


def nmt(path):
    text = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(r"Total:\s*reserved=[^\n]*?committed=(\d+)KB", text)
    return int(match[1])*1024 if match else None


def case(root):
    receipt = json.loads((root/"run.json").read_text(encoding="utf-8"))
    process, jvm, gpu = rows(root/"process.jsonl"), rows(root/"jvm-gl.jsonl"), rows(root/"gpu.jsonl")
    pid = receipt.get("pid")
    process = [row for row in process if row.get("pid") == pid]
    jvm = [row for row in jvm if row.get("pid") == pid]
    is_micro=receipt["mode"].startswith("micro-")
    # Use render-relative warmup, not launch time. Shader compilation and a
    # loading screen must not be reported as steady scene performance.
    rendering = [row for row in jvm if row.get("frames", 0) > 0]
    world=[]; previous_world_frames=0
    for row in jvm:
        value=row.get("worldFrames",0)
        if value>previous_world_frames: world.append(row)
        previous_world_frames=value
    phase=rendering if is_micro else world
    expected=receipt["mode"]=="shader-on"
    first_match=next((i for i,row in enumerate(phase) if row.get("shadersEnabled") is expected),None)
    active=phase if is_micro else phase[first_match:] if first_match is not None else []
    steady_at = active[0]["atMs"]+10_000 if active else float("inf")
    phase_end = active[-1]["atMs"] if active else 0
    steady_process = [row for row in process if steady_at<=row["atMs"]<=phase_end]
    steady_jvm = [row for row in active if row["atMs"]>=steady_at]
    growth_at = active[0]["atMs"] if active else float("inf")
    growth_process=[row for row in process if growth_at<=row["atMs"]<=phase_end]
    a, b = (steady_jvm[0],steady_jvm[-1]) if len(steady_jvm)>1 else ({},{})
    delta = {key:value-a.get("api",{}).get(key,0) for key,value in b.get("api",{}).items()}
    name_delta = {key:value-a.get("trackedNames",{}).get(key,0) for key,value in b.get("trackedNames",{}).items()}
    first_active,last_active=(active[0],active[-1]) if len(active)>1 else ({},{})
    active_api_delta={key:value-first_active.get("api",{}).get(key,0) for key,value in last_active.get("api",{}).items()}
    active_name_delta={key:value-first_active.get("trackedNames",{}).get(key,0) for key,value in last_active.get("trackedNames",{}).items()}
    fps = [(y["frames"]-x["frames"])*1000/(y["atMs"]-x["atMs"]) for x,y in zip(steady_jvm,steady_jvm[1:]) if y["atMs"]>x["atMs"]]
    observed_shaders = sorted(set(row["shadersEnabled"] for row in (active or phase) if type(row.get("shadersEnabled")) is bool))
    renderers = sorted(set(row["renderer"] for row in (active or phase) if row.get("renderer")))
    totals = [{"file":file.name,"totalCommittedBytes":nmt(file)} for file in sorted(root.glob("*-nmt.txt"))]
    last = jvm[-1] if jvm else {}
    world_pipeline = sum(value for key,value in last.get("api",{}).items() if key.endswith("IrisRenderingPipeline.<init>"))
    gpu_rows = [row for row in gpu if row.get("pid")==pid and row.get("available") is True]
    warnings = []
    if len(steady_jvm)<3 or len(steady_process)<3: warnings.append("insufficient steady render samples (a guard may have stopped the run before warmup)")
    if not all("intel" in name.lower() and "d3d12" in name.lower() for name in renderers) or not renderers: warnings.append("actual Intel D3D12 renderer not established")
    if not is_micro and not world: warnings.append("no fresh world render frames; menu/loading is not a world test")
    if not is_micro and observed_shaders != [receipt["mode"]=="shader-on"]: warnings.append("shader state missing/mixed/mismatched; do not use this as the requested on/off arm")
    if not is_micro and any(type(row.get("shadersEnabled")) is not bool for row in active): warnings.append("shader telemetry has unknown samples inside the active world window")
    if receipt["mode"]=="shader-on" and world_pipeline==0: warnings.append("no observed Iris world pipeline construction; menu rendering is not a world test")
    if not gpu_rows: warnings.append("PID GPU counters unavailable; missing is not zero")
    if not any(value["totalCommittedBytes"] is not None for value in totals): warnings.append("NMT totals unavailable")
    coverage=last.get("coverage",{})
    if not any(key.startswith("org/lwjgl/opengl/") and type(value) is int for key,value in coverage.items()): warnings.append("GL observer coverage missing")
    if any(isinstance(value,str) for value in coverage.values()): warnings.append("one or more observer transformations failed; name counts incomplete")
    if last.get("observerErrors") or last.get("ledgerOverflow") or last.get("sampleBudgetReached"):
        warnings.append("observer error/cap: resource accounting incomplete")
    return {"run":root.name,"receipt":receipt,"renderer":renderers,"observedShaderStates":observed_shaders,
            "renderWarmupMs":steady_at if active else None,"steadyProcessSampleCount":len(steady_process),"worldRenderSampleCount":len(world),
            "processPrivateSlopeBytesPerSecond":slope(steady_process,"privateBytes"),
            "activeRenderPrivateSlopeBytesPerSecond":slope(growth_process,"privateBytes"),
            "activeRenderWindowStartsAtMs":growth_at if active else None,
            "heapUsedSlopeBytesPerSecond":slope(steady_jvm,"heapUsed"),
            "heapCommittedSlopeBytesPerSecond":slope(steady_jvm,"heapCommitted"),
            "privatePeakBytes":max((row["privateBytes"] for row in process),default=None),
            "heapPeakBytes":max((row["heapUsed"] for row in jvm),default=None),
            "sampledSwapFpsMedian":statistics.median(fps) if fps else None,
            "sampledSwapFpsMinimum":min(fps) if fps else None,
            "apiDelta":delta,"trackedNameDelta":name_delta,"lastObserverSample":last,
            "activeApiDelta":active_api_delta,"activeTrackedNameDelta":active_name_delta,
            "nmt":totals,"gpuSampleCount":len(gpu_rows),"lastGpuSample":gpu_rows[-1] if gpu_rows else None,
            "galliumResources":gallium_summary(root/"gallium.xml") if (root/"gallium.xml").is_file() else None,
            "warnings":warnings,"verified":False,"cause":"unconfirmed"}


def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument("root",type=Path); args=p.parse_args()
    cases=[case(file.parent) for file in sorted(args.root.glob("*/run.json"))]
    result={"schema":"camera-memory-analysis/v1","cause":"unconfirmed","productionAcceptance":False,"runs":cases,
        "interpretation":[
            "Private bytes include Java committed pages and some driver allocations; never add private, NMT and GPU shared usage together.",
            "NMT tracks HotSpot, not all LWJGL/Mesa/Intel allocations. A private-minus-NMT gap is a clue, not exact driver memory.",
            "GL generated/deletion-request name counts do not measure backing stores or completed destruction; bindings, GPU fences and caches matter.",
            "Stable name counts plus storage/update/copy churn and growing private/PID GPU usage require driver allocation stacks and completed-fence evidence.",
            "A fresh shader pipeline/resize every frame points toward pipeline/target churn; inspect sampled stacks before proposing a code change.",
            "This bounded QA runner terminates its child. It cannot certify normal exit, photos, album delivery or continuous production stability."
        ]}
    (args.root/"analysis.json").write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    lines=["# Native camera memory diagnostics", "", "Cause unconfirmed; no production acceptance.", "",
           "| Run | Private MiB/s | Heap MiB/s | Swap FPS median | Warnings |", "|---|---:|---:|---:|---|"]
    for row in cases:
        def mb(value): return "unavailable" if value is None else f"{value/1024**2:.2f}"
        lines.append(f"| {row['run']} | {mb(row['processPrivateSlopeBytesPerSecond'])} | {mb(row['heapUsedSlopeBytesPerSecond'])} | {row['sampledSwapFpsMedian']} | {'; '.join(row['warnings'])} |")
    lines += ["", *result["interpretation"]]
    (args.root/"analysis.md").write_text("\n\n".join(lines[:4])+"\n"+"\n".join(lines[4:])+"\n",encoding="utf-8")
    print(json.dumps({"runs":len(cases),"analysis":str(args.root/"analysis.json"),"verified":False}))


if __name__=="__main__": main()
