"""Read-only audit of the locked native Domum network component codec.

MAW_DOMUM_AUDIT_ROOT selects the private lab (same selector as cutter audit).
Only hashes and javap reads are used; no Java bootstrap, server, connection,
world, registry export, lock or Git is mutated. Live production stays separate.
"""
from pathlib import Path
import hashlib
import os
import re
import subprocess
import unittest

DOMUM_SHA = "04c0c902bdbcbd48e38bee5a323907ae0b7b7db4ff4a3e4da7c45334b65610a1"
NATIVE_SERVER_SHA = "1808fab692dc44b2d474295d1cdd9f1fe8a7dceab4f594210873646fafdf1359"


@unittest.skipUnless(os.environ.get("MAW_DOMUM_AUDIT_ROOT"), "private locked Domum root not selected")
class DomumTextureCodecAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(os.environ["MAW_DOMUM_AUDIT_ROOT"])
        cls.javap = Path(os.environ.get("MAW_DOMUM_AUDIT_JAVA", "E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe")).with_name("javap.exe")
        cls.domum = root / "server/mods/domum-ornamentum-1.0.231-main.jar"
        cls.native = root / "server/libraries/net/neoforged/neoforge/21.1.248/neoforge-21.1.248-server.jar"
        for file, digest in ((cls.domum, DOMUM_SHA), (cls.native, NATIVE_SERVER_SHA)):
            if hashlib.sha256(file.read_bytes()).hexdigest() != digest:
                raise AssertionError("Locked primary source changed: " + str(file))

    def bytecode(self, file, *names):
        result = subprocess.run([str(self.javap), "-classpath", str(file), "-p", "-c", *names],
                                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr[-3000:])
        return result.stdout

    def test_registered_texture_component_uses_native_stream_not_nbt_codec(self):
        code = self.bytecode(self.domum, "com.ldtteam.domumornamentum.component.ModDataComponents")
        self.assertIn("String texture_data", code)
        self.assertIn("MaterialTextureData.STREAM_CODEC:", code)
        self.assertIn("DataComponentType$Builder.networkSynchronized:", code)
        static = code.split("static {};", 1)[1]
        self.assertLess(static.index("String texture_data"), static.index("MaterialTextureData.STREAM_CODEC:"))

    def test_material_texture_wire_is_resource_location_to_block_registry_map(self):
        code = self.bytecode(self.domum, "com.ldtteam.domumornamentum.client.model.data.MaterialTextureData")
        static = code.split("static {};", 1)[1]
        stream = static.split("ResourceLocation.STREAM_CODEC:", 1)[1]
        for call in ("Registries.BLOCK:", "ByteBufCodecs.registry:", "ByteBufCodecs.map:", "StreamCodec.map:"):
            self.assertIn(call, stream)
        self.assertLess(stream.index("Registries.BLOCK:"), stream.index("ByteBufCodecs.registry:"))
        self.assertLess(stream.index("ByteBufCodecs.registry:"), stream.index("ByteBufCodecs.map:"))
        self.assertNotIn("Registries.ITEM:", stream)
        self.assertNotIn("COMPOUND_TAG", stream)
        self.assertNotIn("writeNbt", stream)

    def test_locked_native_map_count_resource_key_and_registry_id_primitive_layout(self):
        codecs = self.bytecode(self.native, "net.minecraft.network.codec.ByteBufCodecs", "net.minecraft.network.codec.ByteBufCodecs$22", "net.minecraft.network.codec.ByteBufCodecs$25")
        for call in ("VarInt.read:", "VarInt.write:", "ByteBufCodecs.readCount:", "ByteBufCodecs.writeCount:",
                     "RegistryAccess.registryOrThrow:", "IdMap.byIdOrThrow:", "IdMap.getIdOrThrow:"):
            self.assertIn(call, codecs)
        map_body = codecs.split('class net.minecraft.network.codec.ByteBufCodecs$22 ', 1)[1].split('class net.minecraft.network.codec.ByteBufCodecs$25 ', 1)[0]
        self.assertIn("Map.forEach:", map_body)
        self.assertIn("Map.put:", map_body)
        resource = self.bytecode(self.native, "net.minecraft.resources.ResourceLocation")
        static = resource.split("static {};", 1)[1]
        self.assertIn("ByteBufCodecs.STRING_UTF8:", static)
        self.assertIn("StreamCodec.map:", static)
        self.assertIn("STREAM_CODEC:", static)


if __name__ == "__main__":
    unittest.main()
