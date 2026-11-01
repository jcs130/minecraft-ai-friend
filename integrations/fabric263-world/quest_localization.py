"""Localize real quest definitions and generator prose, preserving all rules."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import re
import zipfile

from prepare import HERE


def quest_archive(config):
    lock = json.loads((HERE / "pack.lock.json").read_text(encoding="utf-8"))
    entry = next(e for e in lock["mods"] if e["slug"] == "justquests")
    return zipfile.ZipFile(Path(config["cache"]) / entry["filename"])


def strings(node, prefix=()):
    if isinstance(node, str):
        yield "/".join(prefix), node
    elif isinstance(node, dict):
        for key, value in node.items():
            yield from strings(value, prefix + (key,))
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from strings(value, prefix + (str(index),))


def transform(node, translations, prefix=()):
    if isinstance(node, str):
        return translations["/".join(prefix)]
    if isinstance(node, dict):
        return {key: transform(value, translations, prefix + (key,)) for key, value in node.items()}
    if isinstance(node, list):
        return [transform(value, translations, prefix + (str(index),)) for index, value in enumerate(node)]
    return node


def source_bundle(config):
    with quest_archive(config) as archive:
        quests = {Path(name).stem: json.loads(archive.read(name)) for name in archive.namelist()
                  if name.startswith("data/justquests/justquests/quests/") and name.endswith(".json")}
        templates = json.loads(archive.read("justquests_genv2/templates.json"))
        themes = json.loads(archive.read("justquests_genv2/themes.json"))["themes"]
        for name in archive.namelist():
            if name.startswith("justquests_genv2/catalog/profiles/") and name.endswith(".json"):
                themes.extend(json.loads(archive.read(name)).get("themes", []))
        reference = json.loads(archive.read("justquests_genv2/lang/fr_fr.json"))
        tags = json.loads(archive.read("justquests_genv2/tags.json"))["concepts"]
        messages = json.loads(archive.read("justquests_genv2/rewards.json"))["messages"]
    existing = Path(config["server"]) / "world/justquests/generator_v2.json"
    generated = json.loads(existing.read_text(encoding="utf-8")) if existing.exists() else {"quests": [], "retained": []}
    return {"quests": quests, "templates": templates, "themes": themes, "reference": reference,
            "tags": tags, "messages": messages, "generated": generated}


def english(text):
    return text["en_us"] if isinstance(text, dict) else text


def extra_catalog(config):
    bundle = source_bundle(config)
    quests, generator = {}, dict(strings(bundle["templates"], ("templates",)))
    for key, quest in bundle["quests"].items():
        for field in ("title", "description"):
            quests["builtin/" + key + "/" + field] = english(quest[field])
    for theme in bundle["themes"]:
        generator.update(strings({field: theme[field] for field in ("names", "descriptions") if field in theme}, ("themes", theme["key"])))
    for hint in bundle["reference"]["hints"]:
        generator["hints/" + hashlib.sha256(hint.encode()).hexdigest()] = hint
    for key, concept in bundle["tags"].items():
        generator["tagNouns/" + key] = concept["name"]
    generator.update(strings(bundle["messages"], ("messages",)))
    return {"_maw_quests": {"en_us": quests, "zh_cn": {}, "origins": []},
            "_maw_generator": {"en_us": generator, "zh_cn": {}, "origins": []}}


def add_chinese(quest, title, description):
    result = copy.deepcopy(quest)
    for field, text in (("title", title), ("description", description)):
        result[field] = {**(result[field] if isinstance(result[field], dict) else {"en_us": result[field]}), "zh_cn": text}
    assert {k: v for k, v in result.items() if k not in ("title", "description")} == {k: v for k, v in quest.items() if k not in ("title", "description")}
    return result


def typed_names(identity, language):
    namespace, path = identity.split(":", 1)
    potion = re.fullmatch(r"minecraft:potion\{minecraft:([a-z_]+)\}", identity)
    kinds = ("item",) if potion else ("item", "block", "entity", "biome")
    result = {}
    for kind in kinds:
        key = "item.minecraft.potion.effect." + potion.group(1) if potion else kind + "." + namespace + "." + path.replace("/", ".")
        if key in language:
            result[kind + ":" + identity] = language[key]
    return result


def build_generator(config, translations, language):
    bundle = source_bundle(config)
    result = {"format": 1, "language": "zh_cn", "grammar": {"sentenceEnd": "。", "sentenceSep": "", "listSep": "、", "listAnd": "和", "lowerNames": False, "lowerAfterColon": False},
              "templates": transform(bundle["templates"], translations, ("templates",)),
              "themes": {}, "tagNouns": {}, "hints": {}, "messages": transform(bundle["messages"], translations, ("messages",)), "names": {}}
    for theme in bundle["themes"]:
        result["themes"][theme["key"]] = {field: transform(theme[field], translations, ("themes", theme["key"], field)) for field in ("names", "descriptions") if field in theme}
    result["hints"] = {hint: translations["hints/" + hashlib.sha256(hint.encode()).hexdigest()] for hint in bundle["reference"]["hints"]}
    result["tagNouns"] = {key: translations["tagNouns/" + key] for key in bundle["tags"]}
    unresolved = []
    for identity in bundle["reference"]["names"]:
        namespace, path = identity.split(":", 1)
        if namespace not in {"minecraft", "farmersdelight"}:
            continue  # These optional generator profiles are not installed.
        names = typed_names(identity, language)
        if not names:
            unresolved.append(identity)
        else:
            result["names"][identity] = next(iter(names.values()))
            result["names"].update(names)
    if unresolved:
        raise ValueError("Installed generator names unresolved: " + ", ".join(unresolved))
    return result
