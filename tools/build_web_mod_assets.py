"""Build the existing modern-viewer schema from current D JARs and a live dump.

No game connection, model download, service control or world mutation. PNGs are
decoded for atlas safety; animated resources get their first declared frame.
"""
from __future__ import annotations
import argparse
import base64
from collections import Counter, defaultdict
from copy import deepcopy
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import struct
import time
import tomllib
import zipfile
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "vendor/modern-viewer/mod-assets"
VANILLA = Path("C:/Users/lzl19/AppData/Roaming/.minecraft/versions/Rapid Optimization/Rapid Optimization.jar")
FALLBACK = "qiandeng_web:block/unsupported"
OLD_BRIDGE = 'a.customTextures={...a.customTextures??{},blocks:{tileSize:void 0,textures:e.textures??{}}},!0):!1}'
NEW_BRIDGE = 'a.customTextures={...a.customTextures??{},blocks:{tileSize:void 0,textures:e.textures??{}},items:{tileSize:void 0,textures:e.itemTextures??{}}},!0):!1}'
BUDGET_PATCHES = [
    (''.join('\\u%04X' % ord(c) if ord(c) > 127 else c for c in '地牢 2.5D 视角；悬停识别对象，接管后点击地面移动，右键或长按目标选择详情、走近、攻击或使用，滚轮缩放'), '俯视观察镜头；滚轮缩放，仅观察世界，不控制游戏角色'),
    ('let o=Math.max(1,Math.min(4,(navigator.hardwareConcurrency||4)-1));ja=new ire(', 'let o=1;ja=new ire('),
    ('x0=DC(Tk("distance"),2,12,4)', 'x0=DC(Tk("distance"),2,4,2)'),
    ('config:{fpsLimit:60,sceneBackground:"#8fc5ea",statsVisible:0', 'config:{fpsLimit:30,sceneBackground:"#8fc5ea",statsVisible:0'),
    ('let t=window.devicePixelRatio||1;this.renderer.capabilities.isWebGL2', 'let t=Math.min(window.devicePixelRatio||1,1);this.renderer.capabilities.isWebGL2'),
    ('(()=>{let i=document.createElement("pre");i.id="mod-debug-panel"', '(()=>{if(!new URLSearchParams(location.search).has("diagnostic"))return;let i=document.createElement("pre");i.id="mod-debug-panel"'),
    ('function v5(t,e=!1,a=!1){Ju&&', 'function v5(t,e=!1,a=!1){a&&!e&&!new URLSearchParams(location.search).has("diagnostic")&&(t="画面已连接 · "+(od?"环绕":Ma?"俯视":"第一人称"));Ju&&'),
]
BUDGET_PRELUDE = '/* QIANDENG_RENDER_BUDGET_V1 */\nif(typeof document!=="undefined")document.documentElement.dataset.qdDiagnostic=String(new URLSearchParams(location.search).has("diagnostic"));\n'
BUDGET_CSS = '\n/* QIANDENG_DIAGNOSTIC_OPT_IN */\nhtml:not([data-qd-diagnostic="true"]) #mod-debug-panel,html:not([data-qd-diagnostic="true"]) .viewer-hud{display:none!important}\n'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf8")

def canonical(value):
    if not isinstance(value, str) or not value or value.startswith("#"):
        raise ValueError("Invalid resource reference")
    value = value if ":" in value else "minecraft:" + value
    ns, rel = value.split(":", 1)
    if not re.fullmatch(r"[a-z0-9_.-]+", ns) or not re.fullmatch(r"[a-z0-9_./-]+", rel) or ".." in PurePosixPath(rel).parts:
        raise ValueError("Unsafe resource reference")
    return ns + ":" + rel

def infer_states(rows):
    """Infer mixed-radix order, then replay every real state, including enums."""
    rows = sorted(rows, key=lambda row: row[0])
    first = rows[0][0]
    if [r[0] for r in rows] != list(range(first, first + len(rows))):
        raise ValueError("Non-contiguous block state range")
    props = [{k: str(v).lower() for k, v in p.items()} for _, p in rows]
    keys = sorted(props[0])
    if any(sorted(p) != keys for p in props):
        raise ValueError("Inconsistent property names")
    if not keys:
        if len(rows) != 1:
            raise ValueError("Multiple states without properties")
        return []
    change = {k: next((i for i, p in enumerate(props) if p[k] != props[0][k]), len(props)) for k in keys}
    order = sorted(keys, key=lambda k: (-change[k], k))
    product, reverse = 1, []
    for key in reversed(order):
        values = list(dict.fromkeys(p[key] for p in props[::product]))
        if not values or any(p[key] != values[(i // product) % len(values)] for i, p in enumerate(props)):
            raise ValueError("State order could not be represented exactly")
        reverse.append({"name": key, "type": "string", "num_values": len(values), "values": values})
        product *= len(values)
    if product != len(rows):
        raise ValueError("State cardinality does not match range")
    return list(reversed(reverse))

def image_data(data, mcmeta=None):
    image = Image.open(io.BytesIO(data))
    image.load()
    if image.width > 8192 or image.height > 65536:
        raise ValueError("Texture dimensions exceed atlas bound")
    animated = False
    if mcmeta and isinstance(mcmeta.get("animation"), dict):
        a = mcmeta["animation"]
        w = int(a.get("width", image.width))
        h = int(a.get("height", min(image.width, image.height)))
        if w < 1 or h < 1 or image.width % w or image.height % h:
            raise ValueError("Invalid animation frame dimensions")
        frames = a.get("frames") or [0]
        first = frames[0].get("index", 0) if isinstance(frames[0], dict) else frames[0]
        if not isinstance(first, int) or first < 0 or first >= (image.width // w) * (image.height // h):
            raise ValueError("Invalid first animation frame")
        x, y = (first % (image.width // w)) * w, (first // (image.width // w)) * h
        image = image.crop((x, y, x + w, y + h))
        animated = True
    out = io.BytesIO()
    image.convert("RGBA").save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode(), animated

def model_refs(blockstate):
    if isinstance(blockstate, dict):
        for key, value in blockstate.items():
            if key == "model" and isinstance(value, str):
                yield canonical(value)
            elif isinstance(value, (dict, list)):
                yield from model_refs(value)
    elif isinstance(blockstate, list):
        for value in blockstate:
            yield from model_refs(value)

class Assets:
    def __init__(self):
        self.raw_models, self.states, self.png, self.meta, self.lang = {}, {}, {}, {}, {}
        self.model_cache, self.model_errors = {}, {}
        self.jar_rows, self.conflicts, self.ignored_vanilla = [], [], []
        self.seen_assets = {}
        self.vanilla = zipfile.ZipFile(VANILLA)

    def scan(self):
        jars = {}
        for side, directory in (("server", ROOT / "server/mc/mods"), ("client", ROOT / "client/mods")):
            for path in sorted(directory.glob("*.jar")):
                sha = digest(path.read_bytes())
                if sha in jars:
                    jars[sha]["sides"].append(side)
                    jars[sha]["paths"].append(str(path.relative_to(ROOT)))
                else:
                    jars[sha] = {"sha256": sha, "sides": [side], "paths": [str(path.relative_to(ROOT))], "path": path}
        for info in jars.values():
            path = info.pop("path")
            with zipfile.ZipFile(path) as jar:
                bad = jar.testzip()
                if bad:
                    raise ValueError(f"Broken JAR member: {path.name}/{bad}")
                ids = []
                for meta_name in ("META-INF/neoforge.mods.toml", "META-INF/mods.toml"):
                    if meta_name in jar.namelist():
                        metadata = tomllib.loads(jar.read(meta_name).decode("utf8"))
                        ids = [{"id": m.get("modId"), "version": m.get("version")} for m in metadata.get("mods", [])]
                        break
                namespaces = Counter()
                counts = Counter()
                for name in jar.namelist():
                    match = re.fullmatch(r"assets/([a-z0-9_.-]+)/(blockstates/.+\.json|models/(?:block|item)/.+\.json|textures/.+\.png(?:\.mcmeta)?|lang/(?:en_us|zh_cn)\.json)", name)
                    if not match:
                        continue
                    ns, rel = match.groups()
                    if ".." in PurePosixPath(rel).parts or "\\" in rel:
                        raise ValueError("Unsafe JAR asset")
                    if ns == "minecraft":
                        self.ignored_vanilla.append({"jar": path.name, "path": name})
                        continue
                    data = jar.read(name)
                    sha = digest(data)
                    namespaces[ns] += 1
                    if name in self.seen_assets:
                        previous = self.seen_assets[name]
                        if previous["sha256"] != sha:
                            self.conflicts.append({"asset": name, "kept": previous["jar"], "ignored": path.name})
                        continue
                    self.seen_assets[name] = {"jar": path.name, "sha256": sha}
                    if rel.startswith("blockstates/"):
                        self.states[ns + ":" + rel[12:-5]] = json.loads(data)
                        counts["blockstates"] += 1
                    elif rel.startswith("models/"):
                        self.raw_models[ns + ":" + rel[7:-5]] = json.loads(data)
                        counts["models"] += 1
                    elif rel.endswith(".png"):
                        self.png[ns + ":" + rel[9:-4]] = data
                        counts["textures"] += 1
                    elif rel.endswith(".mcmeta"):
                        self.meta[ns + ":" + rel[9:-11]] = json.loads(data)
                    elif rel.startswith("lang/"):
                        self.lang.update(json.loads(data))
                info.update({"mods": ids, "assetNamespaces": sorted(namespaces), "assetCounts": dict(counts), "zipVerified": True})
                self.jar_rows.append(info)

    def raw_model(self, ref):
        if ref.startswith("minecraft:"):
            path = "assets/minecraft/models/" + ref.split(":", 1)[1] + ".json"
            try:
                return json.loads(self.vanilla.read(path))
            except KeyError:
                return None
        return self.raw_models.get(ref)

    def texture_exists(self, ref):
        if ref.startswith("minecraft:"):
            return "assets/minecraft/textures/" + ref.split(":", 1)[1] + ".png" in self.vanilla.namelist()
        return ref in self.png

    def resolve(self, ref, trail=()):
        ref = canonical(ref)
        if ref in self.model_cache:
            return deepcopy(self.model_cache[ref])
        if ref in trail or len(trail) > 32:
            raise ValueError("Parent cycle or excessive model depth")
        model = self.raw_model(ref)
        if not isinstance(model, dict):
            raise ValueError("Missing model " + ref)
        if "loader" in model:
            raise ValueError("Java/NeoForge model loader " + str(model["loader"]))
        parent = model.get("parent")
        base = {}
        if parent:
            parent = canonical(parent)
            if parent in ("minecraft:builtin/generated", "minecraft:item/generated", "minecraft:item/handheld", "minecraft:item/handheld_rod"):
                base = {"parent": "item/generated", "textures": {}}
            elif parent.startswith("minecraft:builtin/"):
                raise ValueError("Java/builtin entity renderer " + parent)
            else:
                base = self.resolve(parent, (*trail, ref))
        result = deepcopy(base)
        result.update({k: deepcopy(v) for k, v in model.items() if k not in ("parent", "textures", "overrides")})
        result["textures"] = {**base.get("textures", {}), **model.get("textures", {})}
        # Texture indirection is resolved after the child has overridden parent
        # bindings, matching Java model inheritance.
        self.model_cache[ref] = deepcopy(result)
        return result

    def final_model(self, ref):
        model = self.resolve(ref)
        textures = model.get("textures", {})
        resolved = {}
        elements = model.get("elements")
        needed = {f["texture"][1:] for e in (elements or []) for f in e.get("faces", {}).values()
                  if isinstance(f.get("texture"), str) and f["texture"].startswith("#")}
        if not elements and "layer0" in textures:
            needed.add("layer0")
        for key in sorted(needed):
            if key not in textures:
                raise ValueError("Missing face texture binding")
            raw = textures[key]
            visited = set()
            while isinstance(raw, str) and raw.startswith("#"):
                target = raw[1:]
                if target in visited or target not in textures:
                    raise ValueError("Missing or cyclic texture variable")
                visited.add(target)
                raw = textures[target]
            tex = canonical(raw)
            if not self.texture_exists(tex):
                raise ValueError("Missing texture " + tex)
            resolved[key] = tex[10:] if tex.startswith("minecraft:") else tex
        model["textures"] = resolved
        if elements:
            for element in elements:
                for face in element.get("faces", {}).values():
                    tex = face.get("texture")
                    if isinstance(tex, str) and tex.startswith("#") and tex[1:] not in resolved:
                        raise ValueError("Missing face texture binding")
                    if isinstance(tex, str) and not tex.startswith("#"):
                        canonical_tex = canonical(tex)
                        if not self.texture_exists(canonical_tex):
                            raise ValueError("Missing direct face texture " + canonical_tex)
                        key = "direct_" + digest(canonical_tex.encode())[:12]
                        resolved[key] = canonical_tex[10:] if canonical_tex.startswith("minecraft:") else canonical_tex
                        face["texture"] = "#" + key
            model["parent"] = "block/block"
        elif "layer0" in resolved:
            model["parent"] = "item/generated"
        else:
            raise ValueError("No JSON geometry or generated item texture")
        return model

def fallback_model():
    return {"parent": "block/cube_all", "textures": {"all": "qiandeng_web:block/unsupported"}}

def public_summary(report):
    summary = {"schema": 1, "generatedAt": report["generatedAt"], "stats": report["stats"],
               "jarCounts": report["jarCounts"], "registry": {k: report["registry"][k] for k in ("generatedAt", "sha256")},
               "staffItems": [{"id": row["id"], "status": "asset_mapped_browser_pending"} for row in report["staffItems"]],
               "ysmWebPlayback": False, "limits": report["limits"],
               "budget": {k: report["bridge"][k] for k in ("workers", "defaultViewDistance", "maximumViewDistance", "fpsLimit", "pixelRatioCap", "maximumPackBytes", "technicalHud", "errorHandlersSuppressed")}}
    if len(json.dumps(summary, ensure_ascii=False).encode("utf8")) >= 16 * 1024:
        raise ValueError("Public compatibility summary exceeds 16 KiB")
    return summary

def patch_bridge():
    path = ROOT / "vendor/modern-viewer/modern-viewer.js"
    data = path.read_bytes().decode("utf8")
    before = digest(path.read_bytes())
    patches = [(OLD_BRIDGE, NEW_BRIDGE), *BUDGET_PATCHES]
    for original, replacement in patches:
        if replacement in data:
            continue
        if data.count(original) != 1:
            raise ValueError("Unexpected renderer bundle; no blind minified patch applied")
        data = data.replace(original, replacement, 1)
    if not data.startswith(BUDGET_PRELUDE):
        data = BUDGET_PRELUDE + data
    path.write_bytes(data.encode("utf8"))
    css = ROOT / "vendor/modern-viewer/viewer.css"
    if BUDGET_CSS not in css.read_text(encoding="utf8"):
        with css.open("a", encoding="utf8", newline="") as target:
            target.write(BUDGET_CSS)
    return {"status": "items_atlas_and_bounded_rendering", "beforeSha256": before, "sha256": digest(path.read_bytes()),
            "workers": 1, "defaultViewDistance": 2, "maximumViewDistance": 4, "fpsLimit": 30, "pixelRatioCap": 1,
            "maximumPackBytes": 20 * 1024 * 1024,
            "technicalHud": "diagnostic query opt-in", "errorHandlersSuppressed": False}

def glb_info(path):
    data = path.read_bytes()
    if len(data) < 20 or data[:4] != b"glTF" or struct.unpack_from("<I", data, 4)[0] != 2 or struct.unpack_from("<I", data, 8)[0] != len(data):
        raise ValueError("Invalid GLB header")
    n, kind = struct.unpack_from("<I4s", data, 12)
    if kind != b"JSON":
        raise ValueError("Invalid GLB JSON chunk marker")
    doc = json.loads(data[20:20+n])
    offset = 12
    while offset < len(data):
        length = struct.unpack_from("<I", data, offset)[0]
        offset += 8 + length
    if offset != len(data):
        raise ValueError("Invalid GLB chunk bounds")
    return {"sha256": digest(data), "bytes": len(data), "animations": len(doc.get("animations", [])),
            "skins": len(doc.get("skins", [])), "nodes": len(doc.get("nodes", [])), "validGlbStructure": True}

def characters():
    root = ROOT / "vendor/modern-viewer/character-assets/characters"
    prepared = ROOT / "assets/prepared-models/characters/naruto-uzumaki-shippuden.glb"
    destination = root / prepared.name
    current = destination.read_bytes()
    fixed = prepared.read_bytes()
    info = glb_info(prepared)
    if current != fixed:
        if len(current) != len(fixed) or current[:16] != fixed[:16] or current[20:] != fixed[20:] or current[16:20] != b"JSPN" or fixed[16:20] != b"JSON":
            raise ValueError("Naruto source is not the previously audited header-only repair")
        destination.write_bytes(fixed)
    rows = []
    for path in sorted(root.glob("*.glb")):
        try:
            row = glb_info(path)
        except ValueError as error:
            row = {"sha256": digest(path.read_bytes()), "validGlbStructure": False, "reason": str(error)}
        rows.append({"path": str(path.relative_to(ROOT)), **row})
    return {"files": rows, "narutoPreparedSource": str(prepared.relative_to(ROOT)),
            "narutoRepair": "Previously audited JSPN->JSON chunk marker only", "ysmWebPlayback": False,
            "playerKiritoNarutoPath": "existing bundle skin-only early return; two local PNGs", "actualWebGlbLoadTested": False}

def build():
    registry_path = ROOT / "server/mc/block-registry.json"
    registry_bytes = registry_path.read_bytes()
    dump = json.loads(registry_bytes)
    if dump.get("minecraftVersion") != "1.21.1" or abs(time.time() * 1000 - dump.get("generatedAt", 0)) > 24 * 3600 * 1000:
        raise ValueError("Require a current MC 1.21.1 live registry dump (within 24h)")
    entries = dump["blockStates"]
    if len({e["stateId"] for e in entries}) != len(entries):
        raise ValueError("Duplicate registry state IDs")
    groups = defaultdict(list)
    for e in entries:
        if not e["block"].startswith("minecraft:"):
            groups[e["block"]].append((e["stateId"], e.get("properties") or {}))
    block_index = {e["name"]: e for e in dump["blocks"]}
    assets = Assets()
    assets.scan()
    models, failures, item_models = {}, {}, {}
    for ref in sorted(assets.raw_models):
        try:
            model = assets.final_model(ref)
            models[ref] = model
            if ":item/" in ref:
                alias = ref.replace(":item/", ":", 1)
                # Actual renderer getItemTexture probes ns:name first; 3D
                # item models without layer0 otherwise never enter its path.
                models[alias] = deepcopy(model)
                item_models[alias] = ref
        except (ValueError, TypeError, KeyError) as error:
            failures[ref] = str(error)
    fallback_png = Image.new("RGBA", (16, 16), (39, 28, 47, 255))
    for y in range(16):
        for x in range(16):
            if (x // 4 + y // 4) % 2:
                fallback_png.putpixel((x, y), (214, 101, 199, 255))
    fp = io.BytesIO()
    fallback_png.save(fp, format="PNG")
    fallback_url, _ = image_data(fp.getvalue())
    models[FALLBACK] = fallback_model()
    states, blocks, unsupported = {}, [], []
    for name in sorted(groups):
        rows = sorted(groups[name])
        state_defs = infer_states(rows)
        bs = assets.states.get(name)
        reason = None
        try:
            refs = list(model_refs(bs)) if bs is not None else []
            if not refs:
                reason = "No JSON blockstate/model references (often a Java block entity renderer)"
            else:
                for ref in refs:
                    if ref.startswith("minecraft:"):
                        assets.final_model(ref)
                    elif ref not in models:
                        raise ValueError(failures.get(ref, "Missing model " + ref))
        except ValueError as error:
            reason = str(error)
        if reason:
            unsupported.append({"block": name, "reason": reason, "states": len(rows), "fallback": FALLBACK})
            bs = {"variants": {"": {"model": FALLBACK}}}
        states[name] = bs
        index = block_index[name]
        if (index["minStateId"], index["maxStateId"]) != (rows[0][0], rows[-1][0]) or not rows[0][0] <= index["defaultState"] <= rows[-1][0]:
            raise ValueError("Registry block summary mismatch")
        blocks.append({"name": name, "displayName": ("[网页简化] " if reason else "") + assets.lang.get("block." + name.replace(":", "."), name),
                       "minStateId": rows[0][0], "maxStateId": rows[-1][0], "defaultState": index["defaultState"],
                       "boundingBox": "block", "transparent": bool(re.search("glass|window|pane|bars|torch|lantern|sapling|flower|chain", name)),
                       "diggable": True, "hardness": 1.5, "drops": [], "states": state_defs})
    # Keep the renderer's native inheritance graph. Expanding every parent into
    # every model and every item alias multiplies structured-clone/worker memory.
    # Only current world block roots and the two requested staffs are preloaded.
    all_resolved = models
    catalogued_items = item_models
    needed = set()
    def visit(ref):
        if ref.startswith("minecraft:") or ref in needed or ref == FALLBACK:
            return
        needed.add(ref)
        parent = assets.raw_models[ref].get("parent")
        if parent:
            visit(canonical(parent))
    for state in states.values():
        for ref in model_refs(state):
            visit(ref)
    staff_refs = ["qiandeng_chanting:item/" + s for s in ("whispering_staff", "resonance_staff")]
    for ref in staff_refs:
        visit(ref)
    compact = {}
    for ref in sorted(needed):
        raw = deepcopy(assets.raw_models[ref])
        raw.pop("overrides", None)
        if isinstance(raw.get("textures"), dict):
            raw["textures"] = {k: v[10:] if isinstance(v, str) and v.startswith("minecraft:") else v for k, v in raw["textures"].items()}
        compact[ref] = raw
    compact[FALLBACK] = fallback_model()
    item_models = {}
    for ref in staff_refs:
        alias = ref.replace(":item/", ":", 1)
        compact[alias] = all_resolved[ref]
        item_models[alias] = ref
    models = compact
    resolved_for_atlas = [all_resolved[ref] for ref in needed if ref in all_resolved]
    used_textures = {canonical(v) for model in resolved_for_atlas for v in model.get("textures", {}).values() if not v.startswith("#") and not v.startswith("qiandeng_web:")}
    textures, item_textures = {"qiandeng_web:unsupported": fallback_url}, {}
    animated = []
    for ref in sorted(used_textures):
        if ref.startswith("minecraft:"):
            continue  # unchanged vanilla atlas is already embedded in viewer
        url, animation = image_data(assets.png[ref], assets.meta.get(ref))
        if animation:
            animated.append(ref)
        block_key = ref.replace("block/", "", 1).replace("blocks/", "", 1)
        item_key = block_key.replace("item/", "", 1).replace("items/", "", 1)
        if block_key in textures and textures[block_key] != url:
            raise ValueError("Block atlas key collision: " + block_key)
        textures[block_key] = url
        # No broad inventory catalogue is preloaded in the world view. The
        # two staffs are geometry using the block atlas, so items stays empty.
    namespaces = sorted({x.split(":")[0] for x in states} | {x.split(":")[0] for x in item_models})
    stats = {"blockstates": len(states), "models": len(models), "textures": len(textures), "itemTextures": len(item_textures),
             "blocks": len(blocks), "exactStateMappings": sum(len(x) for x in groups.values()), "fallbackBlocks": len(unsupported), "itemModels": len(item_models),
             "cataloguedItemModels": len(catalogued_items), "deferredItemModels": len(catalogued_items) - len(item_models)}
    pack = {"schemaVersion": 1, "minecraft": "1.21.1", "mods": namespaces, "stats": stats,
            "blockstates": states, "models": models, "textures": textures, "itemTextures": item_textures}
    OUT.mkdir(parents=True, exist_ok=True)
    write_json(OUT / "mod-pack.json", pack)
    if (OUT / "mod-pack.json").stat().st_size > 20 * 1024 * 1024:
        raise ValueError("World render pack exceeds the 20 MiB startup budget")
    write_json(OUT / "mod-blocks-mcdata.json", {"minecraft": "1.21.1", "blocks": blocks})
    for staff in ("whispering_staff", "resonance_staff"):
        key = "qiandeng_chanting:" + staff
        if key not in item_models or not models[key].get("elements"):
            raise ValueError("Staff item must retain actual JSON geometry")
    bridge = patch_bridge()
    registry_mirror = ROOT / "server/world-data/block-registry.json"
    registry_mirror.parent.mkdir(parents=True, exist_ok=True)
    temporary = registry_mirror.with_name("block-registry.json.web-stage-" + str(time.time_ns()))
    try:
        with temporary.open("xb") as handle:
            handle.write(registry_bytes)
        if digest(temporary.read_bytes()) != digest(registry_bytes):
            raise ValueError("Registry mirror copy failed verification")
        os.replace(temporary, registry_mirror)
    finally:
        if temporary.exists():
            temporary.unlink()
    report = {"schema": 1, "generatedAt": int(time.time() * 1000), "minecraft": "1.21.1", "neoforge": "21.1.248",
              "registry": {"path": str(registry_path.relative_to(ROOT)), "mirrorPath": str(registry_mirror.relative_to(ROOT)), "mirrorSha256": digest(registry_mirror.read_bytes()), "generatedAt": dump["generatedAt"], "sha256": digest(registry_bytes), "allBlocks": len(dump["blocks"]), "allStates": len(entries)},
              "stats": stats, "jars": assets.jar_rows, "jarCounts": {side: sum(side in r["sides"] for r in assets.jar_rows) for side in ("server", "client")},
              "unsupportedBlocks": unsupported, "unsupportedModels": failures, "animatedTexturesUseFirstFrame": animated,
              "assetConflicts": assets.conflicts, "ignoredVanillaOverrides": assets.ignored_vanilla,
              "staffItems": [{"id": "qiandeng_chanting:" + s, "model": item_models["qiandeng_chanting:" + s], "elements": len(models["qiandeng_chanting:" + s]["elements"]), "textures": models["qiandeng_chanting:" + s]["textures"]} for s in ("whispering_staff", "resonance_staff")],
              "itemModelAliases": item_models, "bridge": bridge, "characters": characters(),
              "limits": ["Java/GeckoLib block entity renderers use explicit checker cubes", "Entity geometry/animations are not supplied by this block/item pack", "No YSM Web playback", "Animated block textures show one frame", "Native collision/occlusion/tint behavior is not a full Java renderer", "Current server item numeric registry is not exported; caller must retain canonical item names", "Only two staff item aliases preloaded; broad inventory catalogue deferred for memory", "One mesher worker; distance defaults to 2 and is capped at 4; pixel ratio capped at 1"],
              "actualBrowserRenderTested": False, "sourceBuildersReviewed": ["C scripts/build-mod-asset-pack.py", "C packaging/docker/modern-viewer/extract-mod-assets.py"]}
    write_json(OUT / "compatibility-report.json", report)
    write_json(OUT / "compatibility-summary.json", public_summary(report))
    # Vanilla IDs also move when a content mod adds properties to vanilla blocks
    # (Spawn adds three note-block instruments). Keep this sidecar generation in
    # the same asset build; the server validates its registry hash before use.
    import importlib.util
    state_spec = importlib.util.spec_from_file_location("web_state_map_builder", ROOT / "tools/build_web_state_map.py")
    state_module = importlib.util.module_from_spec(state_spec)
    state_spec.loader.exec_module(state_module)
    state_module.build()
    assets.vanilla.close()
    return {"ok": True, "jarCounts": report["jarCounts"], **stats, "assetConflicts": len(assets.conflicts), "packBytes": (OUT / "mod-pack.json").stat().st_size}

if __name__ == "__main__":
    argparse.ArgumentParser(description=__doc__).parse_args()
    print(json.dumps(build(), ensure_ascii=False, indent=2))
