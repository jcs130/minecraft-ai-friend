# -*- coding: utf-8 -*-
"""路径锚点门禁③：关键文件的默认路径必须从 B 仓自身派生（REPO 相对），不许再出现跨仓绝对路径。

静态断言（不 import——边车模块 import 即联网/起服务），锚定 2026-08-26 清理后的正典写法。
谁改崩了锚点（比如又把默认值写回绝对路径），提交即红。
"""
import io
import os
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def text(rel):
    return io.open(os.path.join(REPO, rel), encoding="utf-8", errors="strict").read()


def has(rel, needle, msg=None):
    return rel, needle, msg


class TestSidecarAnchors(unittest.TestCase):

    def test_guard_drive(self):
        t = text("sidecar/guard/guard_drive.py")
        self.assertIn('os.path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs")', t,
                      "守卫桥 TSX 默认值必须走本仓 node_modules")
        self.assertIn('os.path.join(_REPO, "mc-data", "rcon-secret.txt")', t,
                      "守卫桥 RCON secret 候选必须锚 B 仓 mc-data")

    def test_mcp_numen(self):
        t = text("sidecar/guard/mcp_numen.py")
        self.assertIn('os.path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs")', t)
        self.assertIn('os.path.join(WORLD_DATA, "rcon-secret.txt")', t,
                      "mcp RCON secret 必须跟 WORLD_DATA 同源")

    def test_mc_npc(self):
        t = text("sidecar/mc_npc.py")
        self.assertIn('os.path.join(_REPO, "mc-data")', t, "NPC 引擎默认数据目录必须 B 仓 mc-data")

    def test_mc_gateway(self):
        t = text("mc-gateway/mc_gateway.py")
        self.assertIn('_REPO = str(Path(__file__).resolve().parent.parent)', t)
        self.assertIn('os.path.join(_REPO, "mc-data")', t)
        self.assertIn('os.path.join(_REPO, "mc-server")', t)


class TestLauncherAnchors(unittest.TestCase):

    def test_start_world_bat(self):
        t = text("start-world.bat")
        self.assertIn("MC_DATA_DIR=%~dp0mc-data", t, "世界进程数据目录必须相对仓库根")
        self.assertIn("TSX=%~dp0node_modules\\.bin\\tsx.CMD", t, "TSX 必须用本仓 node_modules")

    def test_start_panel_bat(self):
        t = text("start-panel.bat")
        self.assertIn("MC_DATA_DIR=%~dp0mc-data", t)
        self.assertIn("MC_SERVER_DIR=%~dp0mc-server", t)

    def test_restart_world_shim(self):
        t = text("restart_world.py")
        self.assertIn("restart-world.py", t, "旧入口必须转发到 ops/restart-world.py")


class TestServerAnchors(unittest.TestCase):

    def test_user_jvm_args_settlementsfix(self):
        """settlementsfix class 内嵌旧绝对路径默认值，必须由 -D 三键压住（免重编译方案）。"""
        t = text(os.path.join("mc-server", "user_jvm_args.txt"))
        for key in ("settlementsfix.interactFile", "settlementsfix.spellFile", "settlementsfix.statusFile"):
            self.assertIn(f"-D{key}=", t, f"缺 -D{key}（mod 会写去 class 内嵌旧路径）")
            # 且值必须落在 B 仓 mc-data 下
        for line in t.splitlines():
            if line.strip().startswith("-Dsettlementsfix."):
                self.assertIn("mc-data", line, f"-D 值未锚 mc-data: {line.strip()[:80]}")

    def test_compose_mounts(self):
        t = text(os.path.join("ops", "docker", "docker-compose.yml"))
        self.assertGreaterEqual(t.count("../mc-data:/app/data"), 3,
                                "compose 数据面挂载必须锚 B 仓 mc-data")


class TestPackagingAnchors(unittest.TestCase):

    def test_dist_scripts_default_to_repo(self):
        for rel in ("scripts/build-dist-assets.py", "scripts/stage-mc-server.py"):
            t = text(rel)
            self.assertIn('os.environ.get("MC_HARNESS_ROOT", REPO)', t,
                          f"{rel} 默认根必须是本仓 REPO（外部打包经 MC_HARNESS_ROOT 覆盖）")


if __name__ == "__main__":
    unittest.main()
