# 临时探针：验证 mcp_numen.py 作为 MCP server 能连上、工具能返回真实数据。
# 用 qwenpaw venv 的 mcp 库做 stdio client，调 Naruto 身体的工具。
import asyncio, os, sys
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

PY = r"C:\Users\lzl19\.qwenpaw\venv\Scripts\python.exe"
SCRIPT = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\sidecar\guard\mcp_numen.py"
WORKDIR = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend"


async def main():
    env = dict(os.environ)
    env["NUMEN_COMPANION"] = "Naruto"
    env["NUMEN_DISPLAY"] = "鸣人"
    params = StdioServerParameters(command=PY, args=[SCRIPT], env=env, cwd=WORKDIR, stderr=None)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            names = [t.name for t in tools.tools]
            print("TOOLS_COUNT:", len(names))
            print("TOOLS:", ",".join(names))
            # 测两个只读工具：世界信息 + 身体状态
            for tname in ("get_world_info", "get_self_status"):
                try:
                    res = await session.call_tool(tname, {})
                    print(f"\n[{tname}]")
                    for c in res.content:
                        print(" ", getattr(c, "text", getattr(c, "value", c)))
                except Exception as e:
                    print(f"[{tname}] ERROR: {type(e).__name__}: {e}")


if __name__ == "__main__":
    asyncio.run(main())
