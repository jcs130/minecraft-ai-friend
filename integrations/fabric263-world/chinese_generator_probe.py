"""Pure native naming regression; no quests, mobs or inventory are modified."""
import json
from pathlib import Path
import sys
import zipfile
import java
from graalweave import client

Provider = java.type("baritone.api.BaritoneAPI").getProvider().getPrimaryBaritone()
uri = Provider.getClass().getProtectionDomain().getCodeSource().getLocation().toURI()
root = Path(str(java.type("java.io.File")(uri).getPath())).parent.parent
with zipfile.ZipFile(root / "mods/maw-fabric263-compat-0.1.1.jar") as archive:
    encoded = archive.read("justquests_genv2/lang/zh_cn.json").decode("utf-8")

Localization = java.type("com.erikedits.justquests.generator.v2.internal.catalog.Localization")
Target = java.type("com.erikedits.justquests.generator.v2.internal.catalog.TargetDef")
Candidate = java.type("com.erikedits.justquests.generator.v2.internal.gen.Candidate")
Objective = java.type("com.erikedits.justquests.generator.v2.internal.catalog.ObjectiveType")
JavaList = java.type("java.util.List")
Parser = java.type("com.google.gson.JsonParser")
Class = java.type("java.lang.Class")


def validate():
    language = Localization.parse("zh_cn", Parser.parseString(encoded).getAsJsonObject())
    methods = [method for method in Class.forName("com.erikedits.justquests.generator.v2.internal.gen.TextBuilder").getDeclaredMethods()
               if method.getName() == "name" and method.getParameterCount() == 2]
    if len(methods) != 1:
        raise RuntimeError("Reviewed native naming method not found")
    method = methods[0]
    method.setAccessible(True)
    results = []
    for kind, identity, expected in ((Objective.BREED_ANIMAL, "minecraft:rabbit", "兔子"),
                                     (Objective.CONSUME_ITEM, "minecraft:rabbit", "生兔肉"),
                                     (Objective.BREED_ANIMAL, "minecraft:chicken", "鸡"),
                                     (Objective.CONSUME_ITEM, "minecraft:chicken", "生鸡肉")):
        target = Target(kind, identity, JavaList.of(), None, 1.0, 1, 1, 1.0, 0, "none", JavaList.of(), "Fixture", "Fixtures", None, 64, "minecraft:overworld", 0, False, None, None, None)
        candidate = Candidate("vanilla", None, target, kind, identity, False, 0, "animals", "minecraft:overworld", "none", JavaList.of(), 1.0, 1.0, "", 0.0, 1, 1, 64, "Fixture", "Fixtures", 1.0, None)
        actual = method.invoke(None, language, candidate)
        if actual != expected:
            raise RuntimeError("Native item/entity name kind mismatch")
        results.append({"type": kind.typeId(), "id": identity, "name": actual})
    template = json.loads(encoded)["templates"]["titles"]["mine_block"][6]
    if template != "采掘委托：{Name}":
        raise RuntimeError("Mining shift incorrectly treated as a keyboard key")
    return {"kind": "native-chinese-generator", "codes": list(Localization.CODES), "names": results,
            "miningTemplate": template, "gameplayMutated": False}


sys.stdout.write(json.dumps(client.call(validate), ensure_ascii=False) + "\n")
