"""Real stdio protocol check. No RCON calls, game login, world messages, or model calls."""
import asyncio
import json
import os
from pathlib import Path
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

PROJECT = Path(__file__).resolve().parents[2]


async def check():
    params = StdioServerParameters(command=sys.executable,
        args=[str(PROJECT / 'tools' / 'run_numen_mcp.py')],
        env={**os.environ, 'NUMEN_COMPANION': 'QiandengAgent', 'NUMEN_DISPLAY': '千灯使者'})
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            names = {item.name for item in tools.tools}
            assert len(names) == 55
            assert {'get_self_status', 'chant', 'pray', 'read_skill', 'render_view', 'goddess_cli', 'skill_receipt'} <= names
            result = await session.call_tool('read_skill', {'name': 'combat_basics'})
            text = '\n'.join(item.text for item in result.content if getattr(item, 'type', '') == 'text')
            assert not result.isError and len(text) > 100 and 'combat' in text.lower()
    print(json.dumps({'project': 'qiandengji', 'ok': True, 'transport': 'stdio',
                      'listedTools': len(names), 'readSkill': 'combat_basics',
                      'skillCharacters': len(text), 'rconCalls': 0, 'gameLogin': False,
                      'visualRenderingTested': False}))


if __name__ == '__main__':
    asyncio.run(asyncio.wait_for(check(), timeout=25))
