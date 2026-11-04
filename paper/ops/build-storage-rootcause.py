"""Build and verify the AF.52 storage repair against pinned AF.51; never install it."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("server", "jdk", "output"):
        parser.add_argument("--" + key, type=Path, required=True)
    args = parser.parse_args()
    # Keep an administrator's short junction path in the classpath; resolving
    # hundreds of entries to a long NVMe path can exceed CreateProcess limits.
    server, jdk, out = args.server.absolute(), args.jdk.resolve(), args.output.resolve()
    paper = Path(__file__).resolve().parents[1]
    source = paper / "plugins/AgentFriend"
    baseline = server / "plugins/AgentFriend-0.4.47.50-rpg.jar"
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    if sha(baseline) != "8b93dffeff9547ce088601469a93d481c772e562e40d88e2993d366014f76f5e":
        raise ValueError("Expected the reviewed AF.51 baseline; do not patch another release.")
    if out.exists() or out == server.resolve() or out.is_relative_to(server.resolve()):
        raise ValueError("Use a new output directory outside the server.")
    out.mkdir(parents=True)
    classes, empty = out / "classes", out / "empty"
    classes.mkdir()
    empty.mkdir()
    suffix = ".exe" if os.name == "nt" else ""
    tool = lambda name: str(jdk / "bin" / (name + suffix))
    version = subprocess.run([tool("javac"), "-version"], capture_output=True, text=True, check=True)
    if not (version.stdout + version.stderr).startswith("javac 21."):
        raise ValueError("Use JDK 21.")
    libraries = sorted(server.glob("libraries/**/*.jar"))
    cp = os.pathsep.join(map(str, [baseline, *libraries, *sorted(server.glob("plugins/*.jar"))]))
    names = ["AtomicConfigFile", "DurableFileMove", "DurableConfigFiles", "DurableConfigStore", "SiteDungeonManager"]
    tests = ["AtomicConfigFileTest", "DurableConfigFilesTest", "AgentCliRecoveryTest", "DungeonLifecycleTest",
             "DungeonExitAdviceTest", "DungeonAdviceTest", "AgentCliContractTest", "AgentCliTextTest", "NativeCliCatalogTest"]
    files = [*[source / f"src/org/afuhome/agentfriend/{name}.java" for name in names],
             *[source / f"tests/org/afuhome/agentfriend/{name}.java" for name in tests],
             source / "tests/org/afuhome/agentfriend/DurableConfigCrashChild.java",
             paper / "ops/patches/DurableConfigPatch.java", paper / "ops/patches/VerifyDurableConfigPatch.java"]
    options = ["--release", "21", "-proc:none", "-implicit:none", "-encoding", "UTF-8", "-sourcepath", str(empty),
               "-cp", cp, "-d", str(classes), *map(str, files)]
    argfile = out / "compile.args"
    argfile.write_text("\n".join('"' + part.replace("\\", "/") + '"' for part in options), encoding="utf-8")

    def run(command, label, timeout=120):
        if command[0] == tool("java"):
            runtime_args = out / (label + ".args")
            runtime_args.write_text("\n".join('"' + part.replace("\\", "/") + '"' for part in command[1:]), encoding="utf-8")
            command = [command[0], "@" + str(runtime_args)]
        with (out / (label + ".log")).open("wb") as log:
            result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
        if result.returncode:
            raise RuntimeError("Check failed: " + label + "; inspect its retained log.")

    run([tool("javac"), "@" + str(argfile)], "compile")
    lock_exe = None
    if os.name == "nt":
        lock_exe = out / "hold-config-file.exe"
        csc = Path(os.environ["WINDIR"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
        run([str(csc), "/nologo", "/out:" + str(lock_exe), str(source / "tests/fixtures/hold-config-file.cs")], "reader-compile")
    test_cp = str(classes) + os.pathsep + cp
    for name in tests:
        test_args = [str(lock_exe)] if lock_exe and name in ("AtomicConfigFileTest", "DurableConfigFilesTest") else [str(source / "resources")]
        run([tool("java"), "-ea", "-cp", test_cp, "org.afuhome.agentfriend." + name, *test_args], name)
    owner = "org/afuhome/agentfriend/AgentFriendPlugin.class"
    before_class, after_class = out / "AgentFriendPlugin.before.class", out / "AgentFriendPlugin.class"
    with zipfile.ZipFile(baseline) as jar:
        before_class.write_bytes(jar.read(owner))
    run([tool("java"), "-cp", test_cp, "DurableConfigPatch", str(before_class), str(after_class)], "patch")
    run([tool("java"), "-cp", test_cp, "VerifyDurableConfigPatch", str(before_class), str(after_class)], "original-methods")

    def owned(name):
        return (name.startswith("org/afuhome/agentfriend/") and name.endswith(".class")
                and name.rsplit("/", 1)[-1].split("$")[0].removesuffix(".class") in names)

    updates = {file.relative_to(classes).as_posix(): file.read_bytes() for file in classes.rglob("*.class")
               if owned(file.relative_to(classes).as_posix())}
    updates[owner] = after_class.read_bytes()
    target = out / "AgentFriend-0.4.47.52-rpg.jar"
    with zipfile.ZipFile(baseline) as before:
        descriptor = before.read("plugin.yml")
        if descriptor.count(b"0.4.47.51-rpg") != 1:
            raise ValueError("Unexpected plugin metadata.")
        updates["plugin.yml"] = descriptor.replace(b"0.4.47.51-rpg", b"0.4.47.52-rpg")
        if not {name for name in before.namelist() if owned(name)} <= updates.keys():
            raise ValueError("Missing original nested class; preserve the baseline.")
        with zipfile.ZipFile(target, "x", zipfile.ZIP_DEFLATED) as after:
            for entry in before.infolist():
                after.writestr(copy.copy(entry), updates.get(entry.filename, before.read(entry.filename)))
            for name in sorted(updates.keys() - set(before.namelist())):
                after.writestr(name, updates[name])
    with zipfile.ZipFile(baseline) as before, zipfile.ZipFile(target) as after:
        changed = [name for name in before.namelist() if before.read(name) != after.read(name)]
        added = sorted(set(after.namelist()) - set(before.namelist()))
        if not set(changed + added) <= updates.keys() or set(before.namelist()) - set(after.namelist()):
            raise ValueError("Unreviewed archive change.")
        receipt = {"passed": True, "baselineSha256": sha(baseline), "sha256": sha(target),
                   "changedEntries": changed, "addedEntries": added,
                   "otherEntriesPreserved": len(before.namelist()) - len(changed),
                   "tests": tests, "nativeWindowsFileLockTest": bool(lock_exe),
                   "originalMethodsVerified": True, "productionChanged": False}
    (out / "build.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
