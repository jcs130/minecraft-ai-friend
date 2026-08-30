# -*- coding: utf-8 -*-
"""守卫本尊皮肤档案与部署一致性（2026-08-30 桐人/鸣人换动漫皮肤，客户端可见）。

覆盖三块：
  1) ops/guard-skins.json 档案完整性：value 是合法 base64 且解码 JSON 指向
     textures.minecraft.net（客户端零配置可达的公网纹理域）、signature 为
     Mojang 签名 base64（>600 字符）、64x64 原图 png 在档；
  2) 与 numen 侧机制的锚定：档案 target_follow 与 src/guard-follow.mjs 的
     GUARD_FOLLOW_UUID 同源（护花跟随与皮肤档案说的是同一个萌萌）；
  3) 部署 jar 同步一致性（本地部署现场才跑，CI 无 jar 自动 skip）：
     numen 主 jar（CompanionRegistry 所在）必须含 snapshot 方法、numen_act jar
     必须含 skin 命令——防「只替换 actuator jar 没换主 jar」重演
     （2026-08-30 实测坑：NoSuchMethodError CompanionRegistry.snapshot）。
"""
import base64
import json
import os
import re
import struct
import unittest
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKINS_JSON = os.path.join(REPO, "ops", "guard-skins.json")
GUARD_FOLLOW_MJS = os.path.join(REPO, "src", "guard-follow.mjs")
MODS_DIR = os.path.join(REPO, "ops", "docker", "shadow", "mc", "mods")

GUARDS = ("Kirito", "Naruto")


def _png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    w, h = struct.unpack(">II", head[16:24])
    return w, h


class TestGuardSkinsArchive(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        with open(SKINS_JSON, encoding="utf-8") as f:
            cls.doc = json.load(f)

    def test_both_guards_have_archive(self):
        for g in GUARDS:
            self.assertIn(g, self.doc["skins"], f"{g} 皮肤档案缺失")
            s = self.doc["skins"][g]
            self.assertTrue(s["url"].startswith("https://textures.minecraft.net/texture/"),
                            f"{g} 纹理必须挂 Mojang 公网域（客户端零配置可达），当前: {s['url']}")
            self.assertIn("body_refreshed", s.get("applied_result", ""),
                          f"{g} 应用回执须为在线无缝换装（body_refreshed）")

    def test_value_decodes_to_mojang_texture(self):
        for g in GUARDS:
            s = self.doc["skins"][g]
            vpath = os.path.join(REPO, s["value_file"])
            self.assertTrue(os.path.isfile(vpath), f"{g} value 文件缺失: {vpath}")
            value = open(vpath, encoding="utf-8").read().strip()
            decoded = json.loads(base64.b64decode(value, validate=True))
            url = decoded["textures"]["SKIN"]["url"]
            # Mojang textures JSON 官方用 http:// 前缀，客户端两种 scheme 都认——归一化比较
            norm = lambda u: u.replace("http://", "https://")
            self.assertEqual(norm(url), norm(s["url"]), f"{g} value 内 URL 与档案 url 不一致")

    def test_signature_is_mojang_grade_base64(self):
        for g in GUARDS:
            s = self.doc["skins"][g]
            spath = os.path.join(REPO, s["signature_file"])
            sig = open(spath, encoding="utf-8").read().strip()
            self.assertGreater(len(sig), 600, f"{g} 签名过短（{len(sig)}），应为 Mojang 签名级（~684）")
            base64.b64decode(sig, validate=True)  # 合法 base64，不炸即过

    def test_original_png_is_64x64(self):
        # vanilla 客户端只支持 64x64 标准布局；128x128 是 HD 皮肤（需客户端 mod），不收
        for g in GUARDS:
            s = self.doc["skins"][g]
            size = _png_size(os.path.join(REPO, s["png"]))
            self.assertEqual(size, (64, 64), f"{g} 原图必须 64x64，当前 {size}")

    def test_target_follow_matches_guard_follow_mjs(self):
        """护花跟随与皮肤档案必须认同一个萌萌（UUID 同源）。"""
        src = open(GUARD_FOLLOW_MJS, encoding="utf-8").read()
        uuid = self.doc["target_follow"]["uuid"]
        self.assertIn(uuid, src, "guard-follow.mjs 的 GUARD_FOLLOW_UUID 与皮肤档案 target_follow.uuid 不一致")


@unittest.skipUnless(os.path.isdir(MODS_DIR), "部署现场 mods 目录不存在（CI 环境跳过）")
class TestNumenJarsInSync(unittest.TestCase):
    """坑锚（2026-08-30）：numen_act jar 引用新 API（CompanionRegistry.snapshot）时，
    主 jar（CompanionRegistry 所在）必须同步替换——只换 actuator 会 NoSuchMethodError。"""

    def _find_jar(self, prefix):
        cands = [f for f in os.listdir(MODS_DIR)
                 if f.startswith(prefix) and f.endswith(".jar") and ".bak-" not in f]
        self.assertEqual(len(cands), 1, f"{prefix}*.jar 应恰有一个现役（排除 .bak），实际: {cands}")
        return os.path.join(MODS_DIR, cands[0])

    def _class_bytes(self, jar_path, class_suffix):
        """在 jar 本体与内嵌 Jar-in-Jar（NeoForge JiJ，numen api 类藏于
        META-INF/jarjar/*.jar）中递归查找目标 class，返回首个命中的字节。"""
        with zipfile.ZipFile(jar_path) as z:
            names = [n for n in z.namelist() if n.endswith(class_suffix)]
            if names:
                with z.open(names[0]) as f:
                    return f.read()
            for nested in [n for n in z.namelist() if n.startswith("META-INF/jarjar/") and n.endswith(".jar")]:
                with z.open(nested) as nf:
                    import io
                    with zipfile.ZipFile(io.BytesIO(nf.read())) as nz:
                        nn = [n for n in nz.namelist() if n.endswith(class_suffix)]
                        if nn:
                            with nz.open(nn[0]) as f:
                                return f.read()
        self.fail(f"{jar_path}（含内嵌 JiJ）找不到 {class_suffix}")

    def test_main_jar_has_registry_snapshot(self):
        jar = self._find_jar("numen-neoforge")
        data = self._class_bytes(jar, "entity/CompanionRegistry.class")
        self.assertIn(b"snapshot", data,
                      "numen 主 jar 的 CompanionRegistry 缺 snapshot()——与 numen_act jar 不同步，"
                      "皮肤命令会 NoSuchMethodError（须用 numen-reference core/neoforge 新构建同步替换）")

    def test_actuator_jar_has_skin_command(self):
        jar = self._find_jar("numen_act-neoforge")
        data = self._class_bytes(jar, "NumenActCommand.class")
        self.assertIn(b"applySkin", data, "numen_act jar 缺 skin 命令（applySkin）——须用含 2026-08-30 换肤能力的构建")


if __name__ == "__main__":
    unittest.main()
