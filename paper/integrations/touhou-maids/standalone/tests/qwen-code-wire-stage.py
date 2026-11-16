"""Inspect the pinned Qwen Code binary's real HTTP request; no game or online model.

python qwen-code-wire-stage.py --qwen /absolute/qwen.exe --output /fresh/directory
The retained fixture contains only a synthetic credential and local loopback URL.
"""
import argparse
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import sys
import threading
import time

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent), str(HERE.parent.parent / 'harness')]
from qwen_code import QwenCodePlanner


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--qwen', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--max-tokens', type=int, default=320)
    args = parser.parse_args()
    executable = args.qwen.resolve(strict=True)
    if not 96 <= args.max_tokens <= 1024:
        parser.error('--max-tokens must be 96..1024')
    version = subprocess.check_output([str(executable), '--version'], text=True).strip()
    if version != '1.0.0-preview.1':
        parser.error('review a new Qwen version before changing the wire expectations')
    root = args.output.resolve()
    root.mkdir(parents=True, exist_ok=False)
    calls = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            if self.path != '/v1/chat/completions' or self.headers.get('Authorization') != 'Bearer synthetic-fixture-only':
                self.send_error(403)
                return
            value = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            calls.append({key: value.get(key) for key in (
                'model', 'max_tokens', 'max_completion_tokens', 'enable_thinking', 'reasoning_effort', 'stream')})
            common = {'id': 'wire-fixture', 'object': 'chat.completion.chunk',
                      'created': int(time.time()), 'model': value['model']}
            events = [{**common, 'choices': [{'index': 0, 'delta': {
                'role': 'assistant', 'content': '{"action":"rest"}'}, 'finish_reason': None}]},
                {**common, 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}],
                 'usage': {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15}}]
            raw = (''.join('data: ' + json.dumps(row) + '\n\n' for row in events) + 'data: [DONE]\n\n').encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    results = []
    try:
        for variant in ('undeclared', 'declared', 'configured'):
            config_dir = root / variant
            config_dir.mkdir()
            model = {'model': 'tokenplan/qwen3.8-flash'}
            if variant != 'undeclared':
                model['capabilities'] = {'thinking': {'modes': ['enabled'], 'supportsEffort': False}}
            settings = {'providers': {'litellm': {'type': 'openai-compatible', 'protocol': 'openai',
                'baseUrl': f'http://127.0.0.1:{server.server_port}/v1',
                'apiKey': 'synthetic-fixture-only', 'models': [model]}}, 'telemetry': {'enabled': False}}
            if variant == 'configured':
                settings['model'] = {'preferences': {'litellm/tokenplan/qwen3.8-flash': {
                    'maxTokens': args.max_tokens, 'reasoning': {'thinking': {'type': 'disabled'}}}}}
            (config_dir / 'settings.json').write_text(json.dumps(settings), encoding='utf8')
            planner = QwenCodePlanner({'executable': str(executable), 'configDir': str(config_dir),
                                      'maxOutputTokens': args.max_tokens}, 15)
            result = asyncio.run(planner({'cliModel': 'litellm/tokenplan/qwen3.8-flash'}, [{
                'role': 'user', 'content': 'This is a protocol fixture. Reply with JSON {"action":"rest"}.'}], []))
            assert json.loads(result['content']) == {'action': 'rest'}
            results.append({'variant': variant, 'wire': calls[-1]})
        assert len(calls) == 3
        assert calls[0]['enable_thinking'] is None and calls[0]['max_tokens'] is None
        assert calls[1]['enable_thinking'] is False and calls[1]['max_tokens'] is None
        assert calls[2]['enable_thinking'] is False and calls[2]['max_tokens'] == args.max_tokens
        assert calls[2]['reasoning_effort'] == 'none'
        report = {'passed': True, 'qwenVersion': version, 'onlineModelCalls': 0,
                  'gameActionsExecuted': False, 'results': results}
        (root / 'result.json').write_text(json.dumps(report, indent=2), encoding='utf8')
        print(json.dumps(report))
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == '__main__':
    main()
