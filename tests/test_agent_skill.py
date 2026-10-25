"""Verify the exact downloadable Skill, not only its source Markdown."""
import hashlib
import io
import json
from pathlib import Path
import posixpath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / "paper/integrations/agent-portal"
PREFIX = "qiandengji-agent/"


class AgentSkillReleaseTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lock = json.loads((PORTAL / "skill/runtime-lock.json").read_text(encoding="utf-8"))
        cls.file = PORTAL / "public/downloads" / ("qiandengji-agent-" + cls.lock["version"] + ".zip")
        cls.release = json.loads(cls.file.with_suffix(".json").read_text(encoding="utf-8"))
        with zipfile.ZipFile(cls.file) as archive:
            cls.files = {name.removeprefix(PREFIX): archive.read(name) for name in archive.namelist() if not name.endswith("/")}
        cls.manifest = json.loads(cls.files["bundle.json"])

    def test_release_lock_manifest_and_embedded_sdk_agree(self):
        sdk = self.files["assets/runtime/" + self.lock["sdkArchive"]]
        self.assertEqual(self.release["sha256"], hashlib.sha256(self.file.read_bytes()).hexdigest())
        self.assertEqual(self.release["bytes"], self.file.stat().st_size)
        self.assertEqual(self.manifest["version"], self.lock["version"])
        self.assertEqual(self.manifest["sdk"]["version"], self.lock["sdkVersion"])
        self.assertEqual(self.manifest["sdk"]["sha256"], hashlib.sha256(sdk).hexdigest())
        self.assertEqual(self.lock["sdkBytes"], len(sdk))
        self.assertEqual(self.manifest["baseRevision"], self.lock["sdkSourceCommit"])
        with tarfile.open(fileobj=io.BytesIO(sdk), mode="r:gz") as archive:
            package = json.load(archive.extractfile("package/package.json"))
            build = json.load(archive.extractfile("package/dist/build.json"))
        self.assertEqual(package["version"], self.lock["sdkVersion"])
        self.assertFalse(build["viewer"]["included"])
        package = json.loads(self.files["assets/runtime/package.json"])
        npm = json.loads(self.files["assets/runtime/package-lock.json"])
        self.assertEqual(package["version"], self.lock["version"])
        self.assertEqual(npm["version"], self.lock["version"])
        self.assertEqual(package["dependencies"]["agent-mc-world"], "file:" + self.lock["sdkArchive"])
        self.assertEqual(npm["packages"]["node_modules/agent-mc-world"]["version"], self.lock["sdkVersion"])

    def test_every_declared_file_has_its_actual_hash(self):
        expected = {row["path"] for row in self.manifest["files"]}
        self.assertEqual(expected, set(self.files) - {"bundle.json"})
        self.assertEqual(len(expected), len(self.manifest["files"]))
        for row in self.manifest["files"]:
            with self.subTest(file=row["path"]):
                self.assertNotIn("..", row["path"].split("/"))
                self.assertNotIn("node_modules", row["path"].split("/"))
                self.assertEqual(hashlib.sha256(self.files[row["path"]]).hexdigest(), row["sha256"])

    def test_packaged_markdown_navigation_is_complete_and_entry_is_small(self):
        count = 0
        for name, data in self.files.items():
            if not name.endswith(".md"):
                continue
            for href in re.findall(r"\]\(([^\s)]+)\)", data.decode("utf-8")):
                if re.match(r"^[a-z][a-z0-9+.-]*:", href, re.I) or href.startswith("#"):
                    continue
                target = posixpath.normpath(posixpath.join(posixpath.dirname(name), href.split("#")[0]))
                with self.subTest(file=name, link=href):
                    self.assertIn(target, self.files)
                    self.assertFalse(target.startswith("../"))
                count += 1
        self.assertGreater(count, 50)
        self.assertLess(len(self.files["SKILL.md"].decode("utf-8")), 1400)

    def test_old_downloads_remain_immutable(self):
        for version, digest in (
            ("1.0.0", "3d1676e86f31396071866c64ce87d9e6820e1530b755c4221f04c22a15f94669"),
            ("1.1.0", "6a1be95fa174e37c330a756ffdbc32f0924254099390d1fc99a236c451d8fe7d"),
            ("1.2.0", "a0618f8c2d75a71d42ca532973a43f7d837e91ee47707a7ce9de2d9167cf858b"),
            ("1.2.1", "1c3c57962babb47fd2ca2100b12e1d941949e85e6774b63b5cbd1a874e435c66"),
        ):
            file = PORTAL / "public/downloads" / ("qiandengji-agent-" + version + ".zip")
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(), digest)

    def test_fetch_only_pages_match_the_actual_download(self):
        for name in ("join.html", "agent-api.html"):
            html = (PORTAL / "public" / name).read_text(encoding="utf-8")
            with self.subTest(page=name):
                self.assertIn('href="/downloads/agent-skill"', html)
                self.assertNotRegex(html, r'/downloads/qiandengji-agent-[0-9.]+\.zip')
        # Fetch-only readers follow the stable HTTP route too. Verify its
        # actual catalogue target instead of requiring a stale version in HTML.
        script = "import {skillAt} from './src/agent-skill.mjs'; console.log(JSON.stringify(skillAt('/downloads/agent-skill')));"
        result = subprocess.run([shutil.which("node") or "node", "--input-type=module", "--eval", script], cwd=PORTAL, check=True, capture_output=True, text=True)
        current = json.loads(result.stdout)
        self.assertEqual(current["version"], self.lock["version"])
        self.assertEqual(current["sdkVersion"], self.lock["sdkVersion"])
        self.assertEqual(current["sha256"], self.release["sha256"])

    def test_rebuild_is_identical_and_refuses_existing_release(self):
        with tempfile.TemporaryDirectory(prefix="qd-skill-release-") as directory:
            command = [sys.executable, str(PORTAL / "scripts/build-agent-skill.py"), "--output-directory", directory]
            subprocess.run(command, check=True, capture_output=True)
            self.assertEqual((Path(directory) / self.file.name).read_bytes(), self.file.read_bytes())
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)

    def test_checkout_line_endings_do_not_change_the_download(self):
        with tempfile.TemporaryDirectory(prefix="qd-skill-checkout-") as directory:
            portal = Path(directory) / "portal"
            shutil.copytree(PORTAL / "skill", portal / "skill", ignore=shutil.ignore_patterns("node_modules"))
            (portal / "scripts").mkdir()
            shutil.copyfile(PORTAL / "scripts/build-agent-skill.py", portal / "scripts/build-agent-skill.py")
            (portal / "public/downloads").mkdir(parents=True)
            for name in ("qiandengji-agent-1.0.0.zip", self.file.name):
                shutil.copyfile(PORTAL / "public/downloads" / name, portal / "public/downloads" / name)
            helper = portal / "public/agent-register.mjs"
            original = (PORTAL / "public/agent-register.mjs").read_bytes().replace(b"\r\n", b"\n")
            for label, newline in (("lf", b"\n"), ("crlf", b"\r\n")):
                helper.write_bytes(original.replace(b"\n", newline))
                for source in (portal / "skill").rglob("*"):
                    if source.is_file():
                        content = source.read_bytes().replace(b"\r\n", b"\n")
                        source.write_bytes(content.replace(b"\n", newline))
                output = Path(directory) / label
                subprocess.run([sys.executable, str(portal / "scripts/build-agent-skill.py"),
                                "--output-directory", str(output)], check=True, capture_output=True)
                with self.subTest(checkout=label):
                    self.assertEqual((output / self.file.name).read_bytes(), self.file.read_bytes())

    def test_runtime_gate_rejects_missing_and_stale_installs_without_connecting(self):
        with tempfile.TemporaryDirectory(prefix="qd-skill-runtime-") as directory:
            root = Path(directory)
            with zipfile.ZipFile(self.file) as archive:
                archive.extractall(root)
            skill = root / "qiandengji-agent"
            script = """
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {writeFileSync,mkdirSync} from 'node:fs';
import {Socket} from 'node:net';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
Socket.prototype.connect=function(){throw Error('Runtime version check must not connect');};
const root=process.argv[1],expected=process.argv[2];
const {verifyRuntime}=await import(pathToFileURL(join(root,'scripts/setup.mjs')));
assert.throws(()=>verifyRuntime(root),/runtime_dependencies_missing/);
const dir=join(root,'assets/runtime/node_modules/agent-mc-world');mkdirSync(dir,{recursive:true});
writeFileSync(join(dir,'package.json'),JSON.stringify({name:'agent-mc-world',version:'0.0.0'}));
assert.throws(()=>verifyRuntime(root),/installed_core_version_mismatch/);
const rejected=spawnSync(process.execPath,[join(root,'scripts/mcp.mjs'),join(root,'absent/client.json')],{encoding:'utf8'});
assert.equal(rejected.status,1);assert.match(rejected.stderr,/installed_core_version_mismatch/);
writeFileSync(join(dir,'package.json'),JSON.stringify({name:'agent-mc-world',version:expected}));
assert.equal(verifyRuntime(root),expected);
"""
            subprocess.run([shutil.which("node") or "node", "--input-type=module", "--eval", script,
                            str(skill), self.lock["sdkVersion"]], check=True, capture_output=True)


if __name__ == "__main__":
    unittest.main()
