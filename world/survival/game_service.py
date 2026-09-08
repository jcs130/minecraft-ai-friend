"""Start the shared game QwenPaw with the survivor MCP credential in memory."""
import os
import sys
from pathlib import Path


def environment(source=None):
    env = dict(os.environ if source is None else source)
    path = Path(env.get('SURVIVOR_MCP_TOKEN_FILE', '/run/secrets/survivor-mcp'))
    token = path.read_text(encoding='ascii').strip()
    if len(token) < 32 or len(token) > 256 or any(ch.isspace() for ch in token):
        raise ValueError('invalid_survivor_mcp_token')
    env['SURVIVOR_MCP_TOKEN'] = token
    return env


if __name__ == '__main__':
    os.environ.update(environment())
    sys.path.insert(0, '/ops')
    from cron_guard import install
    install('game')
    from qwenpaw.cli.main import cli
    cli(args=['app', '--host', '0.0.0.0', '--port', '8088', '--log-level', 'info'], prog_name='qwenpaw')
