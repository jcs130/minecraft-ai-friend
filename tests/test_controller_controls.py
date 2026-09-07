"""Compile and exercise the actual input edge / restricted QA policy without Minecraft."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
JDK = Path(r"C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin")


class ControllerSafetyTests(unittest.TestCase):
    def test_edge_and_qa_guards(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "runtime") as folder:
            work = Path(folder)
            test = work / "ControllerPolicyCheck.java"
            test.write_text('''
import dev.qiandeng.controls.PressEdge;
import dev.qiandeng.controls.QaPolicy;
import java.nio.file.Path;
public class ControllerPolicyCheck {
  static void require(boolean b) { if (!b) throw new AssertionError(); }
  public static void main(String[] args) {
    PressEdge edge = new PressEdge();
    require(!edge.update(false)); require(edge.update(true));
    for(int i=0;i<200;i++) require(!edge.update(true));
    require(!edge.update(false)); require(edge.update(true));
    require(QaPolicy.enabled(true, "QiandengTest", QaPolicy.CLIENT));
    require(!QaPolicy.enabled(false, "QiandengTest", QaPolicy.CLIENT));
    require(!QaPolicy.enabled(true, "OtherPlayer", QaPolicy.CLIENT));
    require(!QaPolicy.enabled(true, "QiandengTest", Path.of("C:/original/client")));
    for(String action:new String[]{"screenshot", "open_guide", "close"}) require(QaPolicy.valid("qa_1", action));
    for(String action:new String[]{"command", "give", "cast", "open_wheel", "spawn", "execute"}) require(!QaPolicy.valid("qa_1", action));
    require(!QaPolicy.valid("../outside", "screenshot"));
    require(!QaPolicy.valid("", "screenshot"));
    require(!QaPolicy.valid("a".repeat(49), "screenshot"));
    System.out.println("held-input and restricted-QA policy checks passed");
  }
}
''', encoding="utf-8")
            sources = ROOT / "world/client-controls-src/src/dev/qiandeng/controls"
            subprocess.run([str(JDK / "javac.exe"), "--release", "21", "-d", str(work),
                            str(sources / "PressEdge.java"), str(sources / "QaPolicy.java"), str(test)], check=True)
            subprocess.run([str(JDK / "java.exe"), "-cp", str(work), "ControllerPolicyCheck"], check=True)


if __name__ == "__main__":
    unittest.main()
