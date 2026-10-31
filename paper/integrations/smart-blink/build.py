"""Build the MagicSpells extension and narrow guide update over the pinned live AF37.

Produces candidates only. Does not install, reload, restart or alter game data.
"""
from pathlib import Path
import argparse, copy, hashlib, json, os, re, subprocess, zipfile

p = argparse.ArgumentParser(description=__doc__)
for name in ['server', 'jdk', 'output']: p.add_argument('--' + name, type=Path, required=True)
p.add_argument('--addon-only', action='store_true', help='Build the public extension without the pinned home-server guide overlay')
a = p.parse_args()
here = Path(__file__).resolve().parent
paper = here.parents[1]
base = a.server / 'plugins/AgentFriend-0.4.47.37-rpg.jar'
magic = a.server / 'plugins/MagicSpells-4.0-Beta-15.jar'
digest = lambda file: hashlib.sha256(Path(file).read_bytes()).hexdigest()
if not a.addon_only:
    assert digest(base) == 'ece9fa6a7dfbebd8ed7336f6b1478ee95b4f8b8b714c629cbe9b037b3ef3ae5b', 'Rebase explicitly before using another live AF'
assert magic.is_file()
suffix = '.exe' if os.name == 'nt' else ''
a.output.mkdir(exist_ok=False, parents=True)
classes = a.output / 'classes'; classes.mkdir()
libs = [*a.server.glob('libraries/**/*.jar'), *a.server.glob('plugins/*.jar')]
cp = os.pathsep.join(map(str, [classes, *([] if a.addon_only else [base]), *libs]))

def args_file(name, values):
    path = a.output / name
    path.write_text('\n'.join('"' + str(v).replace('\\', '\\\\').replace('"', '\\"') + '"' for v in values), encoding='utf8')
    return '@' + str(path)

source = paper / 'plugins/AgentFriend/src/org/afuhome/agentfriend'
sources = [*here.glob('src/**/*.java'), here / 'tests/BlinkLandingUnavailableTest.java']
if not a.addon_only:
    sources += [source / 'SpellGuide.java', source / 'NativeRpg.java', source / 'AgentCliCatalog.java', paper / 'ops/patches/CompassMethodPatch.java']
with (a.output / 'compile.log').open('wb') as log:
    r = subprocess.run([str(a.jdk / ('bin/javac' + suffix)), args_file('compile.args', ['-proc:none', '-implicit:none', '--release', '21', '-encoding', 'UTF-8', '-cp', cp, '-d', classes, *sources])], stdout=log, stderr=subprocess.STDOUT)
assert r.returncode == 0, 'Inspect compile.log'
rules = subprocess.check_output([str(a.jdk / ('bin/java' + suffix)), args_file('unloaded-rules.args', ['-ea', '-cp', cp, 'org.qiandengji.magic.tests.BlinkLandingUnavailableTest'])], text=True)
assert 'checks=4 passed=true unloadedBlockReads=0' in rules
addon = a.output / 'QiandengjiSmartBlink-0.1.0.jar'
with zipfile.ZipFile(addon, 'x', zipfile.ZIP_DEFLATED) as z:
    for file in sorted((classes / 'org/qiandengji/magic').glob('*.class')):
        z.write(file, file.relative_to(classes).as_posix())
    license_text = (here / 'COPYING').read_text(encoding='utf8')
    assert 'GNU GENERAL PUBLIC LICENSE' in license_text and 'Version 3' in license_text
    z.writestr('META-INF/LICENSE.txt', license_text)
    z.writestr('META-INF/qiandengji-smart-blink.json', json.dumps({'version': '0.1.0', 'magicSpells': '4.0-Beta-15', 'nativeManaOwner': 'AgentFriend', 'newCommands': False}))

if a.addon_only:
    report = {'mode': 'addon-only', 'productionChanged': False, 'unloadedRules': rules.strip(),
              'magicSpellsSha256': digest(magic), 'addon': {'path': str(addon), 'sha256': digest(addon)},
              'sources': {str(file.relative_to(paper)).replace('\\', '/'): digest(file) for file in sources}}
    (a.output / 'build.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    print(json.dumps(report))
    raise SystemExit(0)

changes = {}; proofs = {}
with zipfile.ZipFile(base) as old:
    for name, pattern in [('SpellGuide', '<clinit>'), ('NativeRpg', 'route'), ('AgentCliCatalog', 'createSpecs')]:
        entry = 'org/afuhome/agentfriend/' + name + '.class'
        before = a.output / (name + '.before'); before.write_bytes(old.read(entry))
        target = a.output / (name + '.class')
        result = subprocess.check_output([str(a.jdk / ('bin/java' + suffix)), args_file(name + '.args', ['-cp', cp, 'CompassMethodPatch', before, classes / entry, target, pattern])], text=True)
        proofs[name] = json.loads(result); assert proofs[name]['changedMethods'] == 1
        changes[entry] = target.read_bytes()
    descriptor = old.read('plugin.yml')
    changes['plugin.yml'], count = re.subn(rb'(?m)^version:.*$', b'version: 0.4.47.38-rpg', descriptor)
    assert count == 1
    friend = a.output / 'AgentFriend-0.4.47.38-rpg.jar'
    with zipfile.ZipFile(friend, 'x', zipfile.ZIP_DEFLATED) as z:
        for info in old.infolist(): z.writestr(copy.copy(info), changes.get(info.filename, old.read(info.filename)))
with zipfile.ZipFile(base) as old, zipfile.ZipFile(friend) as new:
    assert old.namelist() == new.namelist()
    assert {n for n in old.namelist() if old.read(n) != new.read(n)} == set(changes)

config = a.output / 'spells-regular.yml'
text = (a.server / 'plugins/MagicSpells/spells-regular.yml').read_text(encoding='utf-8-sig')
head, tail = text.split('\nheal:', 1)
assert head.count('spell-class: ".targeted.BlinkSpell"') == 1
head = head.replace('spell-class: ".targeted.BlinkSpell"', 'spell-class: "org.qiandengji.magic.SmartBlinkSpell"')
head = head.replace('description: Teleport a short distance.', 'description: "瞄准落点优先；未瞄准时沿朝向寻找最远安全地面。"')
head = head.replace('str-cast-self: You blink away!', 'str-cast-self: ""').replace('str-cast-others: "%a blinks away!"', 'str-cast-others: ""')
head = head.replace('str-cant-blink: You cannot blink there.', 'str-cant-blink: "未找到安全落点；未传送、未耗魔。"')
config.write_text(head + '\nheal:' + tail, encoding='utf8')
report = {'productionChanged': False, 'unloadedRules': rules.strip(), 'baseSha256': digest(base), 'magicSpellsSha256': digest(magic), 'friend': {'path': str(friend), 'sha256': digest(friend), 'changedEntries': list(changes), 'methods': proofs}, 'addon': {'path': str(addon), 'sha256': digest(addon)}, 'config': {'path': str(config), 'sha256': digest(config), 'otherSpellsUnchanged': config.read_text().split('\nheal:', 1)[1] == tail}, 'sources': {str(file.relative_to(paper)).replace('\\', '/'): digest(file) for file in sources}}
(a.output / 'build.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
print(json.dumps(report))
