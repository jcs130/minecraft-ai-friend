"""One short request to this project's existing maid provider; no player context."""
from datetime import datetime, timezone
import json
from pathlib import Path
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def main():
    config = json.loads((ROOT / 'server/mc/config/touhou_little_maid/sites/llm.json').read_text(encoding='utf-8'))
    provider = config['codingplan']
    model = 'qwen3.7-plus'
    if not provider.get('enabled') or model not in provider['models']:
        raise ValueError('Expected the imported enabled maid model')
    if provider['url'] != 'https://coding.dashscope.aliyuncs.com/v1/chat/completions':
        raise ValueError('Unexpected provider endpoint')
    report = {'project': 'qiandengji', 'checked_at': datetime.now(timezone.utc).isoformat(),
              'model': model, 'ok': False, 'test': 'provider reply only; no maid entity or player history'}
    request = urllib.request.Request(provider['url'],
        data=json.dumps({'model': model, 'messages': [{'role': 'user', 'content': '这是游戏整合连通测试，请只回复：连接成功。'}],
                         'max_tokens': 64, 'stream': False}).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + provider['secret_key']})
    try:
        with urllib.request.urlopen(request, timeout=50) as response:
            data = json.loads(response.read(256 * 1024))
        content = data['choices'][0]['message'].get('content', '')
        report.update(ok=bool(content.strip()), response_chars=len(content), response=content[:200])
    except Exception as exc:
        report.update(error_type=type(exc).__name__)
        if isinstance(exc, urllib.error.HTTPError):
            report['http_status'] = exc.code
    (ROOT / 'reports/maid-model-smoke.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
