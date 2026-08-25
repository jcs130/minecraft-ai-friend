# -*- coding: utf-8 -*-
"""旧入口薄壳（2026-08-26）：世界进程启停一律走 ops/restart-world.py——B 仓自持
（mc-server / mc-data / node_modules 全在本仓，不再依赖 A 仓 deepseek-harness）。
保留本文件只为兼容旧命令习惯，参数原样转发。"""
import os, subprocess, sys

REPO = os.path.dirname(os.path.abspath(__file__))
sys.exit(subprocess.call(
    [sys.executable, os.path.join(REPO, "ops", "restart-world.py"), *sys.argv[1:]]))
