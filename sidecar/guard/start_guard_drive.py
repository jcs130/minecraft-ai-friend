# -*- coding: utf-8 -*-
"""守卫桥宿主拉起链——已退役（2026-08-30 双轨治理）。

守卫桥唯一权威 = shadow-guard 容器（compose 服务，镜像内 /opt/sidecar/guard）。
历史上宿主 schtask/health_mon/手动都会拉起宿主 guard_drive 实例，与容器服务
并行造成 RCON 双轨+多实例风暴。此文件保留为无害桩：任何来源拉起即打印退役
说明并退出，不再启动任何东西。
"""
import sys

print("[retired] guard_drive 已由 shadow-guard 容器专职承载（2026-08-30 双轨退役），宿主拉起链退役。", flush=True)
sys.exit(0)
