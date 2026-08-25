import urllib.request, json, sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def get(u):
    req = urllib.request.Request(u, headers={'User-Agent': 'mc-god-research/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

targets = {'playerengine': (1600, 4200), 'player2npc': (0, 1500), 'nvdialog': (0, 1500),
           'hollowengine': (0, 1500), 'easy-npc': (0, 1200), 'mamizou': (0, 1500)}
for slug, (a, b) in targets.items():
    p = get('https://api.modrinth.com/v2/project/%s' % slug)
    body = (p.get('body') or '').replace('\r', '')
    print('=' * 18, p['title'], '=' * 18)
    print(body[a:b])
    urls = list(set(re.findall(r'https?://(?:www\.)?(?:github\.com|elefant)[^\s\)\]"\']+', body)))
    for u in urls[:5]:
        print('  LINK:', u)
    print()
