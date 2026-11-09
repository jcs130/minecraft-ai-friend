"""Real Linux process tests; fake binaries never load a GPU or bind a port."""
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from drama_rs_runtime import reap_runtime


@unittest.skipUnless(sys.platform == 'linux' and shutil.which('cc'), 'requires Linux /proc and C compiler')
class ProcessCleanupTests(unittest.TestCase):
    def test_term_escalation_preserves_other_binary_and_port(self):
        source = r'''
        #include <signal.h>
        #include <stdio.h>
        #include <string.h>
        #include <unistd.h>
        int main(int argc, char **argv) {
            if (argc > 4 && strcmp(argv[4], "ignore") == 0) signal(SIGTERM, SIG_IGN);
            puts("ready"); fflush(stdout);
            for (;;) pause();
        }
        '''
        with tempfile.TemporaryDirectory(prefix='drama-reaper-test-') as root:
            root = Path(root)
            code, binary, other = root/'fixture.c', root/'fixture', root/'other'
            code.write_text(source)
            subprocess.run(['cc', str(code), '-o', str(binary)], check=True, capture_output=True)
            shutil.copy2(binary, other)
            children = []
            try:
                for exe, port, mode in [(binary, 31981, 'normal'), (binary, 31981, 'ignore'),
                                         (binary, 31982, 'ignore'), (other, 31981, 'ignore')]:
                    p = subprocess.Popen([str(exe), 'serve', '--addr', f'127.0.0.1:{port}', mode],
                                         stdout=subprocess.PIPE, text=True)
                    self.assertEqual(p.stdout.readline().strip(), 'ready')
                    children.append(p)
                result = reap_runtime(str(binary), '127.0.0.1:31981', grace=.25, kill_wait=3)
                self.assertEqual(set(result['matched']), {children[0].pid, children[1].pid})
                self.assertEqual(result['forced'], [children[1].pid])
                self.assertEqual(result['remaining'], [])
                self.assertEqual(children[0].wait(timeout=2), -15)
                self.assertEqual(children[1].wait(timeout=2), -9)
                self.assertIsNone(children[2].poll())
                self.assertIsNone(children[3].poll())
            finally:
                for child in children:
                    if child.poll() is None:
                        child.kill()
                    child.wait(timeout=3)
                    child.stdout.close()

    def test_public_or_ambiguous_address_is_refused(self):
        for address in ('0.0.0.0:18121', ':18121', '127.0.0.1:*'):
            with self.subTest(address=address), self.assertRaises(ValueError):
                reap_runtime('/bin/true', address, grace=0)

    def test_unrelated_listener_blocks_loading_without_being_stopped(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            address = f'127.0.0.1:{listener.getsockname()[1]}'
            with self.assertRaisesRegex(RuntimeError, 'occupied'):
                reap_runtime('/bin/true', address, grace=0)
            self.assertTrue(listener.fileno() >= 0)


if __name__ == '__main__':
    unittest.main()
