# -*- coding: utf-8 -*-
"""迁移回归门禁①：活代码零旧路径引用。

背景（2026-08-26 事故）：仓库从 A 仓迁到 B 仓后，31 个文件的默认路径仍指向
旧 A 仓目录，咏唱/祈愿石沉大海、填坑填错世界、备份备错盘。本测试保证：
凡是「会被执行的代码」（py/ts/mjs/bat/ps1/yml/toml/json），一个旧路径字符串都不许有。
历史文档（.md）、运行时数据（ops/docker/shadow、data/、mc-data/）不在此列。
"""
import os
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 拼接构造，避免本测试文件自身命中
FORBIDDEN = ["deepseek" + "-harness", "scratch" + "-plugin"]

# 顶层跳过：运行时数据 / 巨型依赖目录 / 存档
SKIP_TOP = {
    ".git", "node_modules", "mc-server", "mc-data", "data",
    "world-precode-20260825", "dist", "build", "__pycache__",
    os.path.join("ops", "docker", "shadow"),  # 影子环境运行时数据（守卫记忆/会话）
}

ACTIVE_EXTS = {".py", ".ts", ".mts", ".mjs", ".js", ".bat", ".cmd", ".ps1",
               ".yml", ".yaml", ".toml", ".json"}


def iter_active_files():
    for root, dirs, files in os.walk(REPO):
        rel_root = os.path.relpath(root, REPO)
        if rel_root == ".":
            dirs[:] = [d for d in dirs if d not in SKIP_TOP]
            continue
        top2 = rel_root.split(os.sep)[:3]
        rel_n = "/".join(top2)
        if any(rel_n.startswith(s.replace(os.sep, "/")) or rel_n == s.replace(os.sep, "/")
               for s in SKIP_TOP):
            dirs[:] = []
            continue
        for fn in files:
            if os.path.splitext(fn)[1].lower() in ACTIVE_EXTS:
                yield os.path.join(root, fn)


def iter_mcserver_configs():
    """mc-server 只扫配置区（排除 world/logs/libraries/mods 等运行时大目录）。"""
    base = os.path.join(REPO, "mc-server")
    skip = {"world", "logs", "libraries", "mods", "crash-reports", "backups",
            "versions", "cache", "journeymap", "defaultconfigs"}
    exts = {".toml", ".properties", ".json", ".bat", ".ps1", ".txt", ".cfg"}
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in skip]
        for fn in files:
            if os.path.splitext(fn)[1].lower() in exts:
                yield os.path.join(root, fn)


class TestNoLegacyPaths(unittest.TestCase):

    def test_active_code_has_no_legacy_repo_paths(self):
        offenders = []
        n = 0
        for p in iter_active_files():
            n += 1
            try:
                text = open(p, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            for i, line in enumerate(text.splitlines(), 1):
                for bad in FORBIDDEN:
                    if bad in line:
                        offenders.append(f"{os.path.relpath(p, REPO)}:{i}: {line.strip()[:90]}")
        self.assertEqual([], offenders,
                         f"{len(offenders)} 处活代码仍引用旧 A 仓路径（扫描 {n} 文件）：\n"
                         + "\n".join(offenders[:20]))
        self.assertGreater(n, 50, "扫描文件数异常，疑似扫描器失效")

    def test_mcserver_configs_have_no_legacy_paths(self):
        offenders = []
        for p in iter_mcserver_configs():
            try:
                text = open(p, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            for i, line in enumerate(text.splitlines(), 1):
                if line.strip().startswith("#"):  # 历史注释允许提及
                    continue
                for bad in FORBIDDEN:
                    if bad in line:
                        offenders.append(f"{os.path.relpath(p, REPO)}:{i}")
        self.assertEqual([], offenders,
                         "mc-server 配置区仍有旧路径：\n" + "\n".join(offenders[:10]))


if __name__ == "__main__":
    unittest.main()
