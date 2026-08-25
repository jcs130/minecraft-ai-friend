# -*- coding: utf-8 -*-
import subprocess, time, os
JAVA = r"C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin\java.exe"
CWD = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "mc-server")
log = open(os.path.join(CWD, "boot-direct.log"), "ab")
p = subprocess.Popen([JAVA, "@user_jvm_args.txt",
                      "@libraries/net/neoforged/neoforge/21.1.73/win_args.txt", "nogui"],
                     cwd=CWD, stdout=log, stderr=subprocess.STDOUT,
                     creationflags=0x00000008 | 0x00000200 | 0x08000000, close_fds=True)
print("java pid", p.pid)
