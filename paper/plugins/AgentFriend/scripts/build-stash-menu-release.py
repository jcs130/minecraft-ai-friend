"""Build only the personal stash compass shortcut over released 0.4.47.12.

The full source includes a held archive feature. Reproduce the old main class
before compiling the menu change; refuse any unreviewed baseline. Never installs
anything or touches a running world's configuration, inventory or authentication.
"""
import argparse
import difflib
import hashlib
import json
import os
import struct
from pathlib import Path
import subprocess
import zipfile

BASE = "d024b51f2f623c16d2b71b02e2e7aa979928bd16d10f9879b35442a7e0ab1f72"
SOURCE = "8a27f56edacf2a050a8f0095cb13bb6639a8dae6"
PACKAGE = "org/afuhome/agentfriend/"
VERSION = "0.4.47.14"
sha = lambda b: hashlib.sha256(b).hexdigest()


def utf8_constants(data):
    count, offset, index, strings = struct.unpack_from(">H", data, 8)[0], 10, 1, []
    sizes = {3: 4, 4: 4, 5: 8, 6: 8, 7: 2, 8: 2, 9: 4, 10: 4, 11: 4,
             12: 4, 15: 3, 16: 2, 17: 4, 18: 4, 19: 2, 20: 2}
    while index < count:
        tag, offset = data[offset], offset + 1
        if tag == 1:
            length = struct.unpack_from(">H", data, offset)[0]
            offset += 2
            strings.append(data[offset:offset + length].decode("utf-8", "replace"))
            offset += length
        else:
            offset += sizes[tag]
        index += 2 if tag in (5, 6) else 1
    return strings


def released_main(text):
    start = text.index('        if(sender instanceof Player p&&args.length>0&&(args[0].equalsIgnoreCase("archive")')
    end = text.index('        if(sender instanceof Player p && java.util.Arrays.stream(args)', start)
    text = text[:start] + text[end:]
    held = [
        '    private PublicArchives archives;\n',
        '    PublicArchives archives(){return archives;}\n',
        '        archives = new PublicArchives(this);\n',
        '        if (archives != null) archives.shutdown();\n',
        '            case "archive", "档案" -> archives.command(player,args);\n',
        '            inv.setItem(20, item(Material.BOOKSHELF,"§6公共档案馆","阅读大家的日记、公告与旅行记录","写书、恢复副本：/mycli archive --help"));\n',
        '                    case 20 -> archives.command(p,new String[]{"archive","menu"});\n',
    ]
    for line in held:
        assert text.count(line) == 1, "Held archive boundary changed"
        text = text.replace(line, "")
    assert "archives" not in text and "PublicArchives" not in text
    return text


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("server", "base-jar", "jdk", "output"):
        p.add_argument("--" + name, required=True, type=Path)
    a = p.parse_args()
    root, out, server = Path(__file__).resolve().parents[1], a.output.resolve(), a.server.resolve()
    assert sha(a.base_jar.read_bytes()) == BASE, "Unreviewed deployed baseline"
    assert not out.exists() and out != server and server not in out.parents
    out.mkdir(parents=True)
    (out / "empty").mkdir()
    cp = os.pathsep.join(map(str, [a.base_jar, server / "versions/1.21.1/paper-1.21.1.jar",
        *sorted((server / "libraries").rglob("*.jar")), *sorted((server / "plugins").glob("*.jar"))]))
    source_path = "paper/plugins/AgentFriend/src/" + PACKAGE + "AgentFriendPlugin.java"
    baseline = released_main(subprocess.check_output(["git", "show", SOURCE + ":" + source_path], cwd=root.parents[2]).decode("utf-8"))
    current = released_main((root / "src" / PACKAGE / "AgentFriendPlugin.java").read_text(encoding="utf-8"))
    # Production's two photo help strings lag behind its actual auto-delivery.
    # Reproduce those old constants for the baseline comparison only. The new
    # menu retains the corrected source help: no map, photo in personal stash.
    with zipfile.ZipFile(a.base_jar) as installed:
        strings = utf8_constants(installed.read(PACKAGE + "AgentFriendPlugin.class"))
    for prefix in ("拍照：技能罗盘", "点击选择第一人称"):
        old = [s for s in strings if s.startswith(prefix)]
        assert len(old) == 1 and "背包" in old[0], "Review changed production photo help"
        import re
        replacements = re.findall('"(' + prefix + '[^"\\n]+)"', baseline)
        assert len(replacements) == 1
        baseline = baseline.replace(replacements[0], old[0])
    for label, source in (("baseline", baseline), ("candidate", current)):
        target, classes = out / label / "source" / PACKAGE / "AgentFriendPlugin.java", out / label / "classes"
        target.parent.mkdir(parents=True)
        classes.mkdir(parents=True)
        target.write_text(source, encoding="utf-8", newline="\n")
        args = ["-proc:none", "-encoding", "UTF-8", "--release", "21", "-sourcepath", str(out / "empty"), "-cp", cp, "-d", str(classes), str(target)]
        argfile = out / (label + ".args")
        argfile.write_text("\n".join('"' + s.replace("\\", "/") + '"' for s in args), encoding="utf-8")
        subprocess.run([str(a.jdk / "bin/javac.exe"), "@" + str(argfile)], check=True)
        if label == "baseline":
            for file in classes.rglob("*.class"):
                name = file.relative_to(classes).as_posix().removesuffix(".class").replace("/", ".")
                def code(path):
                    return subprocess.check_output([str(a.jdk / "bin/javap.exe"), "-p", "-c", "-classpath", str(path), name])
                before, rebuilt = code(a.base_jar), code(classes)
                if before != rebuilt:
                    (out / "baseline-diff.txt").write_text("".join(difflib.unified_diff(before.decode("utf-8", "replace").splitlines(True), rebuilt.decode("utf-8", "replace").splitlines(True))), encoding="utf-8")
                    raise AssertionError("Main baseline bytecode differs; inspect the private build diff")
    candidate = out / "candidate/classes"
    own = lambda name: name == PACKAGE + "AgentFriendPlugin.class"
    jar, unchanged, replaced = out / ("AgentFriend-" + VERSION + ".jar"), [], []
    with zipfile.ZipFile(a.base_jar) as old, zipfile.ZipFile(jar, "x", zipfile.ZIP_DEFLATED) as new:
        assert len(old.namelist()) == len(set(old.namelist()))
        entries = {}
        for entry in old.infolist():
            if entry.filename == "plugin.yml" or own(entry.filename):
                continue
            new.writestr(entry, old.read(entry.filename))
            unchanged.append(entry.filename)
        descriptor = old.read("plugin.yml").decode("utf-8")
        assert descriptor.count("version: '0.4.47.12'") == 1
        entries["plugin.yml"] = descriptor.replace("version: '0.4.47.12'", "version: '" + VERSION + "'").encode()
        for file in sorted(candidate.rglob("*.class")):
            name = file.relative_to(candidate).as_posix()
            if not own(name):
                qualified = name.removesuffix(".class").replace("/", ".")
                def code(path):
                    return subprocess.check_output([str(a.jdk / "bin/javap.exe"), "-p", "-c", "-classpath", str(path), qualified])
                assert code(a.base_jar) == code(candidate), "Unrelated nested class changed"
                continue
            entries[name] = file.read_bytes()
        for name, data in entries.items():
            entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            new.writestr(entry, data)
            replaced.append(name)
    with zipfile.ZipFile(a.base_jar) as old, zipfile.ZipFile(jar) as new:
        assert set(old.namelist()) == set(new.namelist())
        assert all(old.read(n) == new.read(n) for n in unchanged)
        assert not any("PublicArchive" in n for n in new.namelist())
    report = dict(version=VERSION, sha256=sha(jar.read_bytes()), baselineSha256=BASE,
        baselineBytecodeVerified=True, unchangedEntries=len(unchanged), replacedEntries=replaced,
        productionChanged=False)
    (out / "build.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
