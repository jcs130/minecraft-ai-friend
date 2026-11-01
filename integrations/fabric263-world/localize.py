"""Audit pinned mod languages and build a source-owned Chinese overlay.

Vendor JARs are read, never patched. Original strings are kept only in the
operator's private audit; public files contain our translations and keys.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import zipfile

from prepare import HERE, copy_checked, digest, write_json

PACK_NAME = "my-agent-world-zh_cn-0.1.0.zip"
QUEST_PACK = "my-agent-world-quests-zh_cn-0.1.0.zip"

LANG = re.compile(r"assets/([^/]+)/lang/(en_us|zh_cn)\.json$")


def scan_archive(archive, origin, catalog, depth=0):
    if depth > 5:
        raise ValueError("Unexpected nested dependency depth")
    with zipfile.ZipFile(archive) as z:
        for name in sorted(z.namelist()):
            match = LANG.fullmatch(name)
            if match:
                namespace, language = match.groups()
                data = json.loads(z.read(name).decode("utf-8-sig"))
                if not isinstance(data, dict) or any(not isinstance(v, str) for v in data.values()):
                    raise ValueError("Unsupported language format: " + origin + "!" + name)
                entry = catalog[namespace]
                for key, value in data.items():
                    old = entry[language].get(key)
                    if old is not None and old != value:
                        raise ValueError("Conflicting upstream language key: " + namespace + ":" + key)
                    entry[language][key] = value
                entry["origins"].append({"path": origin + "!" + name, "sha256": hashlib.sha256(z.read(name)).hexdigest()})
            elif name.startswith("META-INF/jars/") and name.endswith(".jar"):
                scan_archive(io.BytesIO(z.read(name)), origin + "!" + name, catalog, depth + 1)


def audit(config):
    lock = json.loads((HERE / "pack.lock.json").read_text(encoding="utf-8"))
    catalog = defaultdict(lambda: {"en_us": {}, "zh_cn": {}, "origins": []})
    for entry in lock["mods"] + lock["external"]:
        path = Path(config["cache"]) / entry["filename"]
        for algorithm, expected in entry["hashes"].items():
            if digest(path, algorithm) != expected:
                raise ValueError("Unreviewed vendor bytes: " + entry["filename"])
        scan_archive(path, entry["filename"], catalog)
    from quest_localization import extra_catalog
    catalog.update(extra_catalog(config))
    rows = {}
    for namespace, data in sorted(catalog.items()):
        en, zh = data["en_us"], data["zh_cn"]
        rows[namespace] = {**data, "englishCount": len(en), "chineseCount": len(zh),
                           "missing": {k: v for k, v in en.items() if k not in zh},
                           "sameAsEnglish": {k: v for k, v in en.items() if k in zh and zh[k] == v}}
    return {"schemaVersion": 1, "packLockSha256": digest(HERE / "pack.lock.json"), "namespaces": rows}


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def deterministic_zip(path, files):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    staging = path.with_suffix(path.suffix + ".tmp")
    with zipfile.ZipFile(staging, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    with zipfile.ZipFile(staging) as archive:
        if archive.testzip() is not None:
            raise ValueError("Localization ZIP verification failed")
    staging.replace(path)
    return path


def language_map(config, data, overrides):
    cache = Path(config["cache"])
    with zipfile.ZipFile(cache / "minecraft-26.3-client.jar") as game:
        values = json.loads(game.read("assets/minecraft/lang/en_us.json"))
        version = json.loads(game.read("version.json"))
    indexes = list((cache / "assets/indexes").glob("*.json"))
    if len(indexes) != 1:
        raise ValueError("Expected the prepared game's single asset index")
    index = json.loads(indexes[0].read_text(encoding="utf-8"))
    checksum = index["objects"]["minecraft/lang/zh_cn.json"]["hash"]
    asset = cache / "assets/objects" / checksum[:2] / checksum
    if digest(asset, "sha1") != checksum:
        raise ValueError("Vanilla Chinese asset differs from official metadata")
    values.update(json.loads(asset.read_text(encoding="utf-8")))
    for namespace, row in data["namespaces"].items():
        if namespace.startswith("_"):
            continue
        values.update(row["zh_cn"])
        values.update(overrides[namespace])
    return values, version["pack_version"]


def build_resources(config):
    from translate_missing import candidates, validate
    from quest_localization import add_chinese, build_generator, source_bundle
    data = audit(config)
    rows = candidates(data)
    source = HERE / "localization/zh_cn"
    translations = {namespace: json.loads((source / (namespace + ".json")).read_text(encoding="utf-8"))
                    if (source / (namespace + ".json")).exists() else {} for namespace in data["namespaces"]}
    expected = defaultdict(set)
    for row in rows.values():
        for key in row["keys"]:
            expected[row["namespace"]].add(key)
            if key not in translations[row["namespace"]]:
                raise ValueError("Missing Chinese entry: " + row["namespace"] + ":" + key)
            validate(row["text"], translations[row["namespace"]][key])
    for namespace, values in translations.items():
        if set(values) != expected[namespace]:
            raise ValueError("Unexpected or stale Chinese entry: " + namespace)
    actual, formats = language_map(config, data, translations)
    root = Path(config["cache"]) / "localization"
    resources = {"pack.mcmeta": encoded({"pack": {"description": "My Agent World · 简体中文补全", "min_format": [formats["resource_major"], formats["resource_minor"]], "max_format": [formats["resource_major"], formats["resource_minor"]]}}),
                 "README.txt": "My Agent World 简体中文补全\n仅包含自有翻译；原始模组不被修改。\n命令、ID、占位符和按键名称按原义保留。\n".encode()}
    for namespace, values in translations.items():
        if values and not namespace.startswith("_"):
            resources["assets/" + namespace + "/lang/zh_cn.json"] = encoded(values)
    resource_pack = deterministic_zip(root / PACK_NAME, resources)
    generator = build_generator(config, translations["_maw_generator"], actual)
    write_json(root / "generated/justquests-zh_cn.json", generator)
    bundle = source_bundle(config)
    quest_files = {"pack.mcmeta": encoded({"pack": {"description": "My Agent World · 任务中文文本", "min_format": [formats["data_major"], formats["data_minor"]], "max_format": [formats["data_major"], formats["data_minor"]]}})}
    for key, original in bundle["quests"].items():
        zh = translations["_maw_quests"]
        result = add_chinese(original, zh["builtin/" + key + "/title"], zh["builtin/" + key + "/description"])
        quest_files["data/justquests/justquests/quests/" + key + ".json"] = encoded(result)
    quest_pack = deterministic_zip(root / QUEST_PACK, quest_files)
    coverage = {"schemaVersion": 1, "minecraft": "26.3", "complete": True,
                "entries": sum(len(values) for values in translations.values()),
                "namespaces": {namespace: {"english": row["englishCount"], "overrides": len(translations[namespace]), "remaining": 0} for namespace, row in data["namespaces"].items()},
                "resourcePack": {"filename": PACK_NAME, "sha256": digest(resource_pack)},
                "questDataPack": {"filename": QUEST_PACK, "sha256": digest(quest_pack), "definitions": len(bundle["quests"])},
                "generator": {"templates": True, "themes": len(generator["themes"]), "hints": len(generator["hints"]), "installedNames": sum(not key.startswith(("item:", "block:", "entity:", "biome:")) for key in generator["names"]), "typedNames": sum(key.startswith(("item:", "block:", "entity:", "biome:")) for key in generator["names"]), "locale": "zh_cn"}}
    write_json(root / "coverage.local.json", coverage)
    return coverage


def updated_options(text, pack_name=PACK_NAME):
    lines = text.splitlines()
    fields = dict(line.split(":", 1) for line in lines if ":" in line)
    packs = json.loads(fields.get("resourcePacks", "[]"))
    if not isinstance(packs, list) or any(not isinstance(entry, str) for entry in packs):
        raise ValueError("Existing resource-pack selection is malformed")
    name = "file/" + pack_name
    if name not in packs:
        packs.append(name)
    replacements = {"lang": "zh_cn", "resourcePacks": json.dumps(packs, ensure_ascii=False, separators=(",", ":"))}
    result = []
    for line in lines:
        key = line.split(":", 1)[0]
        if key in replacements:
            result.append(key + ":" + replacements.pop(key))
        else:
            result.append(line)
    result.extend(key + ":" + value for key, value in replacements.items())
    return "\n".join(result) + "\n"


def install_client(config):
    from manage import pid_alive
    process = Path(config["cache"]) / "client-process.local.json"
    if process.exists() and pid_alive(json.loads(process.read_text())["pid"]):
        raise ValueError("Close this client before installing its language pack")
    client = Path(config["client"]).resolve()
    if not (client / "fabric263-lab.json").is_file():
        raise ValueError("Not the owned client instance")
    result = build_resources(config)
    copy_checked(Path(config["cache"]) / "localization" / PACK_NAME, client / "resourcepacks" / PACK_NAME)
    target = client / "options.txt"
    before = target.read_text(encoding="utf-8") if target.exists() else ""
    after = updated_options(before)
    if before != after:
        if target.exists():
            saved = Path(config["cache"]) / "localization" / ("options-before-" + digest(target) + ".txt")
            copy_checked(target, saved)
        target.write_text(after, encoding="utf-8", newline="\n")
    return result


def install_server(config):
    from backup import assert_stopped
    from quest_localization import add_chinese
    if (Path(config["cache"]) / "server-process.local.json").exists():
        assert_stopped(config)
    server = Path(config["server"]).resolve()
    if not (server / "fabric263-lab.json").is_file():
        raise ValueError("Not the owned server instance")
    result = build_resources(config)
    copy_checked(Path(config["cache"]) / "localization" / QUEST_PACK, server / "world/datapacks" / QUEST_PACK)
    target = server / "world/justquests/generator_v2.json"
    if target.exists():
        before = json.loads(target.read_text(encoding="utf-8"))
        texts = json.loads((HERE / "localization/legacy-generated-zh_cn.json").read_text(encoding="utf-8"))
        original_hash = digest(target)
        copy_checked(target, Path(config["cache"]) / "localization" / ("generator-before-" + original_hash + ".json"))
        for row in before["quests"] + before.get("retained", []):
            from quest_localization import english
            chosen = {}
            for field in ("title", "description"):
                value = row["quest"][field]
                identity = hashlib.sha256(english(value).encode()).hexdigest()
                chosen[field] = texts.get(identity) or (value.get("zh_cn") if isinstance(value, dict) else None)
                if not chosen[field]:
                    if identity not in texts:
                        raise ValueError("Legacy generated text needs an explicit translation before migration")
                    chosen[field] = texts[identity]
            row["quest"] = add_chinese(row["quest"], chosen["title"], chosen["description"])
        write_json(target, before)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["audit", "build", "install-client", "install-server"])
    args = parser.parse_args()
    config = json.loads((HERE / "deployment.local.json").read_text(encoding="utf-8"))
    if args.action != "audit":
        function = {"build": build_resources, "install-client": install_client, "install-server": install_server}[args.action]
        result = function(config)
        if args.action.startswith("install-"):
            config["localization"] = result
            write_json(HERE / "deployment.local.json", config)
        print(json.dumps({key: result[key] for key in ("complete", "entries", "resourcePack", "questDataPack", "generator")}, ensure_ascii=False))
        return
    data = audit(config)
    target = Path(config["cache"]) / "localization" / "audit.local.json"
    write_json(target, data)
    print(json.dumps({"audit": str(target), "namespaces": {
        k: {"english": v["englishCount"], "chinese": v["chineseCount"],
            "missing": len(v["missing"]), "same": len(v["sameAsEnglish"])} for k, v in data["namespaces"].items()}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
