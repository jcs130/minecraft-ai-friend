"""Extract factual ingredient alternatives from the exact official Java 1.21.1 client."""

import argparse
import hashlib
import json
from pathlib import Path
import zipfile

VERSION = "1.21.1"
SHA1 = "30c73b1c5da787909b2f73340419fdf13b9def88"


def extract(jar: Path) -> dict:
    if hashlib.sha1(jar.read_bytes()).hexdigest() != SHA1:
        raise ValueError("Expected the official, unmodified Java 1.21.1 client JAR")
    recipes, tags = {}, {}
    with zipfile.ZipFile(jar) as archive:
        def read(name):
            return json.loads(archive.read(name))

        def tagged(value):
            if isinstance(value, dict):
                return "tag" in value or any(tagged(v) for v in value.values())
            return isinstance(value, list) and any(tagged(v) for v in value)

        def references(value):
            if isinstance(value, dict):
                if "tag" in value:
                    yield value["tag"]
                for child in value.values():
                    yield from references(child)
            elif isinstance(value, list):
                for child in value:
                    yield from references(child)

        def load_tag(name):
            if name in tags:
                return
            namespace, path = name.split(":", 1)
            values = read(f"data/{namespace}/tags/item/{path}.json")["values"]
            if not all(isinstance(value, str) for value in values):
                raise ValueError(f"Unsupported ingredient tag values: {name}")
            tags[name] = values
            for value in values:
                if value.startswith("#"):
                    load_tag(value[1:])

        for name in sorted(archive.namelist()):
            if not name.startswith("data/minecraft/recipe/") or not name.endswith(".json"):
                continue
            recipe = read(name)
            if recipe.get("type") not in ("minecraft:crafting_shaped", "minecraft:crafting_shapeless") or not tagged(recipe):
                continue
            recipe["result"].setdefault("count", 1)
            item = recipe["result"]["id"].removeprefix("minecraft:")
            recipes.setdefault(item, []).append(recipe)
            for tag in references(recipe):
                load_tag(tag)
    return {"version": VERSION, "source": {"url": f"https://piston-data.mojang.com/v1/objects/{SHA1}/client.jar",
        "sha1": SHA1, "scope": "tagged crafting recipes and transitive item tags; server results remain authoritative"},
        "recipes": recipes, "tags": dict(sorted(tags.items()))}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jar", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text(json.dumps(extract(args.jar), ensure_ascii=False, separators=(",", ":"))+"\n",
        encoding="utf-8", newline="")
