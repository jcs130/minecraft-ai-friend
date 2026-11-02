"""A redirected resident JVM must not run an interactive EOF console loop."""
from pathlib import Path
import re
import unittest


class BackgroundConsoleFlags(unittest.TestCase):
    def test_resident_jvm_uses_noninteractive_terminal(self):
        script=(Path(__file__).parents[1]/'manage-server.ps1').read_text(encoding='utf-8-sig')
        start=script.split('function Start-Server {',1)[1].split('\nfunction ',1)[0]
        literal=re.search(r"\$javaArguments = @\(([^\n]+)\)",start)
        self.assertIsNotNone(literal)
        values=re.findall(r"'([^']+)'",literal.group(1))
        self.assertEqual(values.count('-Dterminal.jline=false'),1)
        self.assertEqual(values.count('-Dterminal.ansi=false'),1)
        self.assertIn('-Xms1G',values)
        self.assertIn('-Xmx4G',values)
        self.assertIn('-Dpaper.preferSparkPlugin=true',values)
        self.assertTrue(any(v.startswith('-Xlog:gc*,safepoint:')for v in values))
        self.assertIn('($javaArguments +',start)
        self.assertIn('-WindowStyle Hidden -RedirectStandardOutput',start)


if __name__=='__main__':unittest.main()
