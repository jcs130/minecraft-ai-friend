# -*- coding: utf-8 -*-
# kill_world.py — 按 cmdline 匹配杀掉世界进程树（bootstrap-world），供看门狗/演练复用
import sys
sys.stdout.reconfigure(encoding='utf-8')
import psutil

killed = []
for p in psutil.process_iter(['pid', 'name', 'cmdline']):
    try:
        if (p.info['name'] or '').lower() != 'node.exe':
            continue
        cl = ' '.join(p.info['cmdline'] or [])
        if 'bootstrap-world' in cl:
            p.kill()  # 杀主进程；tsx 子进程随进程组退出
            killed.append(p.info['pid'])
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        pass
print('killed world pids:', killed if killed else '(none found)')
