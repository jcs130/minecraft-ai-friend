"""Build the 0.4.47.4 RPG candidate over the exact deployed 0.4.47.3 binary.

The main source tree also contains the separate, unpublished 0.4.48 archive.
This explicit release builder compiles only the RPG classes and removes the two
archive dispatch/catalog references from temporary copies. It never installs a
JAR, changes a running server, or edits the original sources/player data.
Requires Python 3.10+ and JDK 21; see paper/docs/RPG_STORY.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

BASE_HASH = "3a7b8e09b4c4be38f5a18add7223a24074bfb813dbc4d55102e70c84863c889d"
NAMES = (
    "RpgStoryRules", "RpgStoryContent", "RpgStoryNpcs", "RpgCampaign",
    "WorldLifeManager", "SiteDungeonManager", "AgentEntry",
    "AgentCommunication", "AgentCliCatalog", "GoddessObservation",
)
RESOURCES = (
    "rpg-story.yml", "dungeons.yml", "route-contracts.yml",
    "world-life.yml", "text-bubbles.yml", "exam-supplies.yml",
)
PACKAGE = "org/afuhome/agentfriend/"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def backport(name: str, text: str) -> str:
    """Fail closed if the narrowly excluded future feature has changed shape."""
    if name == "AgentCommunication":
        block = ('        if(root.equals("archive")){\n'
                 '            String[] query=Arrays.copyOf(args,args.length+1);query[args.length]="--json";\n'
                 '            plugin.archives().command(p,query);return;\n'
                 '        }\n')
        if text.count(block) != 1:
            raise ValueError("Archive dispatch changed; review the release boundary")
        text = text.replace(block, "")
    elif name == "AgentCliCatalog":
        lines = text.splitlines(keepends=True)
        specs = [line for line in lines if line.lstrip().startswith('add(specs,"archive')]
        queries = [line for line in lines if line.lstrip().startswith('if(id.startsWith("archive"))query=')]
        if len(specs) != 9 or len(queries) != 1:
            raise ValueError("Archive catalog changed; review the release boundary")
        text = "".join(line for line in lines if line not in specs + queries)
        if text.count('||id.startsWith("archive")') != 2 or text.count('Set.of("archive","tasks"') != 1:
            raise ValueError("Archive catalog semantics changed; review the release boundary")
        text = text.replace('||id.startsWith("archive")', "").replace('Set.of("archive","tasks"', 'Set.of("tasks"')
    if 'plugin.archives()' in text or 'add(specs,"archive' in text:
        raise ValueError("Future archive reference leaked into the RPG candidate")
    return text


def owned_class(name: str) -> bool:
    return name.startswith(PACKAGE) and name.endswith(".class") and Path(name).stem.split("$")[0] in NAMES


def fixed_entry(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    return info


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", required=True, type=Path, help="Read-only Paper installation for libraries")
    parser.add_argument("--base-jar", required=True, type=Path, help="Exact released AgentFriend-0.4.47.3.jar")
    parser.add_argument("--java-bin", required=True, type=Path, help="JDK 21 bin directory")
    parser.add_argument("--out", required=True, type=Path, help="A new, empty build directory; never a plugins directory")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    server = args.server.resolve()
    target = args.out.resolve()
    if target == server or server in target.parents or target.name.lower() == "plugins":
        raise ValueError("Build outside the server and its plugins directory")
    if target.exists() and any(target.iterdir()):
        raise FileExistsError("Output must be empty; do not overwrite an existing candidate")
    base_data = args.base_jar.read_bytes()
    if sha(base_data) != BASE_HASH:
        raise ValueError("Unexpected production base; do not release over an unreviewed binary")
    javac = args.java_bin / ("javac.exe" if (args.java_bin / "javac.exe").exists() else "javac")
    version = subprocess.run([str(javac), "-version"], check=True, capture_output=True, text=True)
    if not (version.stdout + version.stderr).startswith("javac 21."):
        raise ValueError("This release requires JDK 21")
    target.mkdir(parents=True, exist_ok=True)
    generated = target / "source" / PACKAGE
    classes = target / "classes"
    generated.mkdir(parents=True, exist_ok=True)
    classes.mkdir()
    sources, source_hashes = [], {}
    for name in NAMES:
        original = repo / "src" / PACKAGE / (name + ".java")
        source_hashes[original.relative_to(repo).as_posix()] = sha(original.read_bytes())
        if name in {"AgentCommunication", "AgentCliCatalog"}:
            path = generated / original.name
            path.write_text(backport(name, original.read_text(encoding="utf-8")), encoding="utf-8", newline="\n")
        else:
            path = original
        sources.append(path)
    paper = server / "versions/1.21.1/paper-1.21.1.jar"
    if not paper.is_file():
        raise FileNotFoundError("Expected Paper 1.21.1 installation")
    libraries = sorted((server / "libraries").rglob("*.jar")) + sorted((server / "plugins").glob("*.jar"))
    import os
    cp = os.pathsep.join(str(p.resolve()) for p in [args.base_jar, paper, *libraries])
    compiler_args = ["-proc:none", "-encoding", "UTF-8", "-source", "21", "-target", "21", "-cp", cp, "-d", str(classes), *map(str, sources)]
    argfile = target / "javac.args"
    argfile.write_text("\n".join('"' + a.replace("\\", "/").replace('"', '\\"') + '"' for a in compiler_args), encoding="utf-8")
    subprocess.run([str(javac), "@" + str(argfile)], check=True)
    candidate = target / "AgentFriend-0.4.47.4.jar"
    unchanged, compiled = [], []
    with zipfile.ZipFile(args.base_jar) as old, zipfile.ZipFile(candidate, "x", zipfile.ZIP_DEFLATED) as new:
        names = old.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Base contains duplicate ZIP entries")
        for info in old.infolist():
            if info.is_dir() or owned_class(info.filename) or info.filename == "plugin.yml" or info.filename in RESOURCES:
                continue
            new.writestr(info, old.read(info.filename))
            unchanged.append(info.filename)
        for path in sorted(classes.rglob("*.class")):
            rel = path.relative_to(classes).as_posix()
            if not owned_class(rel):
                raise ValueError("Unexpected compiled class: " + rel)
            compiled.append(rel)
            new.writestr(fixed_entry(rel), path.read_bytes())
        descriptor = old.read("plugin.yml").decode("utf-8")
        if descriptor.count("version: '0.4.47.3'") != 1:
            raise ValueError("Unexpected base plugin version")
        new.writestr(fixed_entry("plugin.yml"), descriptor.replace("version: '0.4.47.3'", "version: '0.4.47.4'"))
        for name in sorted(RESOURCES):
            path = repo / "resources" / name
            source_hashes["resources/" + name] = sha(path.read_bytes())
            new.writestr(fixed_entry(name), path.read_bytes())
    with zipfile.ZipFile(args.base_jar) as old, zipfile.ZipFile(candidate) as new:
        if not all(old.read(n) == new.read(n) for n in unchanged):
            raise ValueError("Unrelated entry changed")
        if any("PublicArchive" in n or n.startswith("org/sqlite/") for n in new.namelist()):
            raise ValueError("Unpublished archive leaked into the candidate")
        catalog = new.read(PACKAGE + "AgentCliCatalog.class")
        if b"archive.status" in catalog or b"world.story.status" not in catalog:
            raise ValueError("Incorrect command catalog boundary")
    report = dict(version="0.4.47.4", sha256=sha(candidate.read_bytes()), baseSha256=BASE_HASH,
                  unrelatedEntriesByteIdentical=len(unchanged), classes=compiled,
                  resources=list(RESOURCES), sources=source_hashes, archivesIncluded=False,
                  productionChanged=False, installationPerformed=False)
    (target / "build.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k not in {"sources", "classes"}}))


if __name__ == "__main__":
    main()
