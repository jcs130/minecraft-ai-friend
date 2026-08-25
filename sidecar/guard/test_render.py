# -*- coding: utf-8 -*-
"""test_render.py —— 端到端验证 render_view：渲染鸣人周围环境图，确认返回 MCP 图片 content。"""
import asyncio
import os
import sys
import time

BASE = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend"
sys.path.insert(0, os.path.join(BASE, "sidecar", "guard"))
sys.path.insert(0, BASE)

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main():
    server = StdioServerParameters(
        command=sys.executable,
        args=[os.path.join(BASE, "sidecar", "guard", "mcp_numen.py")],
        env={**os.environ, "NUMEN_COMPANION": "Naruto", "NUMEN_DISPLAY": "鸣人"},
    )
    t0 = time.time()
    async with stdio_client(server) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            r = await session.call_tool("render_view", {"mode": "top"})
            dt = time.time() - t0
            print(f"render_view(top) took {dt:.1f}s")
            for c in r.content:
                print("content type:", c.type, "| len:", len(getattr(c, "data", "") or ""),
                      "| mime:", getattr(c, "mimeType", None),
                      "| text:", str(getattr(c, "text", ""))[:300])
            if any(c.type == "image" for c in r.content):
                print(">>> IMAGE OK (可给 qwen3.8 视觉)")


if __name__ == "__main__":
    asyncio.run(main())
