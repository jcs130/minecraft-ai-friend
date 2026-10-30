"""The two source-audited Domum overrides; every other ambiguity remains closed.

NeoForge 21.1.248 and 21.1.250 contain the same ResourcePackLoader.class:
89f699b517eb79e76d48eb7387b31939b38938ac70d68b0764f8db8b0f83ac3b.
The rule also matches the shared renderer's independent reader/exporter checks.
"""
CLIENT='499f6897d1837516680f3114072d8106e11c9adcd933fe5cf051b551089b0c99'
DOMUM='04c0c902bdbcbd48e38bee5a323907ae0b7b7db4ff4a3e4da7c45334b65610a1'
PLATFORMS={'neoforge-21.1.248-universal.jar':'90a56f70425711b4e1a4b94ff0c2904ae9f6d74ca6478b3b2152ac794a07b8e5',
           'neoforge-21.1.250-universal.jar':'1f9cc68fe9ec0416475d34ce76e95a696b9721d5d338168563dab0632c3d2956'}
TEXTURES={'assets/minecraft/textures/block/oak_planks.png':('3a33db67a3ba30537d0890a5cb37c8087ca336be89cbb1393a71c23224e361a8','3b00412fec87bd07b83825b86de49bcb6c186ca7799f41721a36b04e5d8ed161'),
          'assets/minecraft/textures/block/dark_oak_planks.png':('2bccdc1ef269b7ae6050d46b70071ead5c3ad4c3a16e3f6baf24fc629752b8bc','3d04f576678df35491ccc43b0fafddce13e310fa5f363ca13193f8a2f55b285b')}
RULE='neoforge-21.1.248-mods-above-vanilla'

def verified(manifest,path,entry):
    hashes=TEXTURES.get(path);sources=manifest.get('sources',[])
    if not hashes or entry.get('priorityResolution')!=RULE or manifest.get('clientJarSha256')!=CLIENT or any(s.get('explicitOverride') for s in sources):return False
    clients=[s for s in sources if s.get('sha256')==CLIENT]
    mods=[s for s in sources if s.get('name')=='domum-ornamentum-1.0.231-main.jar']
    platforms=[s for s in sources if s.get('name') in PLATFORMS]
    if len(clients)!=1 or len(mods)!=1 or mods[0].get('sha256')!=DOMUM or len(platforms)!=1 or platforms[0].get('sha256')!=PLATFORMS[platforms[0]['name']]:return False
    rows=entry.get('variants',[])
    return (len(rows)==2 and rows[0].get('source')==clients[0]['name'] and rows[0].get('sha256')==hashes[0]
            and rows[1].get('source')==mods[0]['name'] and rows[1].get('sha256')==hashes[1]
            and entry.get('source')==mods[0]['name'] and entry.get('sha256')==hashes[1] and entry.get('bytes')==rows[1].get('bytes'))
