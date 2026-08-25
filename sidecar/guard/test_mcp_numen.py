# -*- coding: utf-8 -*-
"""test_mcp_numen.py —— 端到端验证 mcp_numen.py 的 stdio MCP 链路（只读工具）。"""
import asyncio
import os
import sys

BASE = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend"
sys.path.insert(0, os.path.join(BASE, "sidecar", "guard"))
sys.path.insert(0, BASE)

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main():
    server = StdioServerParameters(
        command=sys.executable,
        args=[os.path.join(BASE, "sidecar", "guard", "mcp_numen.py")],
        env={
            **os.environ,
            "NUMEN_COMPANION": "Naruto",
            "NUMEN_DISPLAY": "鸣人",
        },
    )
    async with stdio_client(server) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            print("initialize ok:", init.serverInfo.name, "| protocol:", init.protocolVersion)
            tools = await session.list_tools()
            names = [t.name for t in tools.tools]
            print("tools/list:", len(names), names)
            # 只读工具：身体状态
            r = await session.call_tool("get_self_status", {})
            print("get_self_status raw:", r)
            txt = "\n".join(c.text for c in r.content if c.type == "text")
            print("get_self_status TEXT:", txt)


if __name__ == "__main__":
    asyncio.run(main())
