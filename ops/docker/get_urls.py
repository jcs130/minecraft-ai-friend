import urllib.request, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def get(u, binary=False):
    req = urllib.request.Request(u, headers={'User-Agent': 'mc-god-research/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

def j(u):
    return json.loads(get(u))

vs = j('https://api.modrinth.com/v2/project/collective/version?game_versions=%s&loaders=%s' % (urllib.request.quote('["1.21.1"]'), urllib.request.quote('["neoforge"]')))
v = vs[0]
f = v['files'][0]
print('collective', v['version_number'], f['filename'], f['size'])
data = get(f['url'])
dest = 'mods-candidates/' + f['filename']
open(dest, 'wb').write(data)
print('saved', dest, len(data))
