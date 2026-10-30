"""Add optional auth bindings and two hash-verified MIT library JARs to our build.

Never modifies or redistributes the third-party auth mod. The library bytes come
from the explicitly supplied, pinned old MixAuth distribution; no player DB read.
"""
from pathlib import Path
import argparse, hashlib, json, zipfile

def prepare(build, mixauth, expected_sha256):
    build, mixauth = Path(build).resolve(strict=True), Path(mixauth).resolve(strict=True)
    if hashlib.sha256(mixauth.read_bytes()).hexdigest() != expected_sha256:
        raise ValueError('pinned_mixauth_artifact_required')
    source = Path(__file__).resolve().parents[1]/'forge-addon/src/main/java/dev/qiandeng/maw/saoforge'
    java = build/'src/main/java/dev/qiandeng/maw/saoforge'
    for name in ['SaoAuthentication.java','SaoLegacyPasswords.java']:
        (java/name).write_bytes((source/name).read_bytes())
    (java/'mixins').mkdir(exist_ok=True)
    (java/'mixins/SaoLegacyPasswordMixin.java').write_bytes((source/'mixins/SaoLegacyPasswordMixin.java').read_bytes())
    native = java/'NativeBridge.java'; text = native.read_text(encoding='utf-8')
    old = 'private static boolean loggedIn(ServerPlayer p){return p.getServer()!=null&&p.getServer().getPlayerList().getPlayer(p.getUUID())==p;}'
    if old not in text: raise ValueError('native_auth_binding_changed')
    text = text.replace(old, 'private static boolean loggedIn(ServerPlayer p){return SaoAuthentication.loggedIn(p);}')
    guard = 'if(!loggedIn(p)){error(out,"authentication_required","blocked");sendWorld(p,out);return;}'
    if text.count(guard)!=1: raise ValueError('native_query_auth_guard_changed')
    # Static capability discovery lets the ordinary connection finish startup.
    # Every inventory/menu/state/mutation still requires actual authentication.
    text = text.replace(guard, 'if(!loggedIn(p)&&!(input.has("kind")&&input.get("kind").getAsString().equals("capabilities"))){error(out,"authentication_required","blocked");sendWorld(p,out);return;}')
    text = text.replace('case "capabilities" -> {', 'case "capabilities" -> { out.add("authentication",SaoAuthentication.status(p));')
    native.write_text(text, encoding='utf-8')
    gameplay = java/'SaoGameplay.java'; text = gameplay.read_text(encoding='utf-8')
    needle = 'var out=base(p,operation,requestId,readOnly);'
    if text.count(needle)!=1: raise ValueError('gameplay_auth_binding_changed')
    text = text.replace(needle, needle+'if(!SaoAuthentication.loggedIn(p)){out.addProperty("ok",false);out.addProperty("status","blocked");out.addProperty("reason","authentication_required");out.addProperty("outcomeKnown",true);return out;}')
    gameplay.write_text(text, encoding='utf-8')
    resources = build/'src/main/resources'; config = json.loads((resources/'maw_numen_server.mixins.json').read_text())
    # Existing mixins use a different package, so keep this optional binding in
    # its own config instead of changing the Numen package or defaultRequire.
    (resources/'maw_sao_auth.mixins.json').write_text(json.dumps({'required':False,'minVersion':'0.8','package':'dev.qiandeng.maw.saoforge.mixins','compatibilityLevel':'JAVA_17','mixins':['SaoLegacyPasswordMixin'],'injectors':{'defaultRequire':0}}),encoding='utf-8')
    with zipfile.ZipFile(mixauth) as archive:
        original=json.loads(archive.read('META-INF/jarjar/metadata.json')); rows=[]; provenance={}
        for row in original['jars']:
            if row['identifier']['artifact'] not in {'bcrypt','bytes'}: continue
            relative=row['path']; raw=archive.read(relative); target=resources/relative
            target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw);rows.append(row)
            lib=build/'auth-libs'/Path(relative).name;lib.parent.mkdir(exist_ok=True);lib.write_bytes(raw)
            provenance[relative]=hashlib.sha256(raw).hexdigest()
    if len(rows)!=2:raise ValueError('exact_bcrypt_and_bytes_libraries_required')
    (resources/'META-INF/jarjar/metadata.json').write_text(json.dumps({'jars':rows}),encoding='utf-8')
    gradle=build/'build.gradle'; text=gradle.read_text(encoding='utf-8')
    text+='\ndependencies { compileOnly files(fileTree("auth-libs") { include "*.jar" }) }\njar { manifest { attributes("MixinConfigs": "maw_numen_server.mixins.json,maw_sao_auth.mixins.json") } }\n'
    gradle.write_text(text,encoding='utf-8')
    (build/'auth-dependencies.json').write_text(json.dumps({'sourceSha256':expected_sha256,'libraries':provenance},indent=2),encoding='utf-8')
    return provenance

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--build',required=True);p.add_argument('--mixauth',required=True);p.add_argument('--sha256',required=True);a=p.parse_args();print(json.dumps(prepare(a.build,a.mixauth,a.sha256)))
