# -*- coding: utf-8 -*-
"""语法门禁②：全仓 py 可编译、bat 无双回环/有尾换行、JSON/YAML 可解析。"""
import json
import os
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_TOP = {".git", "node_modules", "mc-server", "mc-data", "data",
            "world-precode-20260825", "dist", "build", "__pycache__",
            os.path.join("ops", "docker", "shadow")}


def iter_by_ext(exts):
    for root, dirs, files in os.walk(REPO):
        rel_root = os.path.relpath(root, REPO)
        if rel_root == ".":
            dirs[:] = [d for d in dirs if d not in SKIP_TOP]
            continue
        rel_n = "/".join(rel_root.split(os.sep)[:3])
        if any(rel_n == s.replace(os.sep, "/") or rel_n.startswith(s.replace(os.sep, "/") + "/")
               for s in SKIP_TOP):
            dirs[:] = []
            continue
        for fn in files:
            if os.path.splitext(fn)[1].lower() in exts:
                yield os.path.join(root, fn)


class TestPythonSyntax(unittest.TestCase):

    def test_all_python_compiles(self):
        bad = []
        n = 0
        for p in iter_by_ext({".py"}):
            n += 1
            try:
                src = open(p, encoding="utf-8", errors="strict").read()
            except (UnicodeDecodeError, OSError) as e:
                bad.append(f"{os.path.relpath(p, REPO)}: 读取失败 {e}")
                continue
            try:
                compile(src, p, "exec")
            except SyntaxError as e:
                bad.append(f"{os.path.relpath(p, REPO)}:{e.lineno}: {e.msg}")
        self.assertEqual([], bad, f"{len(bad)}/{n} 个 py 语法不过：\n" + "\n".join(bad[:15]))
        self.assertGreater(n, 20)


class TestBatSanity(unittest.TestCase):
    """2026-08-26 实锤：start-panel.bat 曾是 \\r\\r\\n 双回环（历史编辑损伤），cmd 静默吃行。"""

    def test_bat_no_double_cr(self):
        bad = []
        for p in iter_by_ext({".bat", ".cmd"}):
            raw = open(p, "rb").read()
            if b"\r\r" in raw:
                bad.append(os.path.relpath(p, REPO))
        self.assertEqual([], bad, "bat 存在 \\r\\r 双回环：\n" + "\n".join(bad))

    def test_bat_ends_with_newline(self):
        bad = []
        for p in iter_by_ext({".bat"}):
            raw = open(p, "rb").read()
            if raw and not raw.endswith(b"\n"):
                bad.append(os.path.relpath(p, REPO))
        self.assertEqual([], bad, "bat 缺尾换行（最后一行会被吃）：\n" + "\n".join(bad))


class TestStructuredFiles(unittest.TestCase):

    def test_package_json_parses(self):
        p = os.path.join(REPO, "package.json")
        if os.path.exists(p):
            json.load(open(p, encoding="utf-8"))

    def test_compose_yml_parses(self):
        try:
            import yaml  # noqa: F401
        except ImportError:
            self.skipTest("pyyaml 未安装")
        p = os.path.join(REPO, "ops", "docker", "docker-compose.yml")
        if os.path.exists(p):
            import yaml
            yaml.safe_load(open(p, encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
