"""Build only recipient-privacy fixes on the pinned live JARs; never install.

The working tree's full AgentFriend version includes unrelated unreleased work.
Keep all other JAR entries byte-identical and use a fresh external output folder.
"""
import argparse, hashlib, json, os, subprocess, zipfile
from pathlib import Path

BASES = {
    'AgentFriend-0.4.47.9.jar': '6b14294c7759873ab775e2cbd43f70ecbf9737fdf761a1ae43d03d7782b54b89',
    'CortiEyeMirror-0.1.16.jar': '53ed34888734289d39f2ef5c69fbb2e213f7b03f30304b0d90496bec2d2b7921'
}
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server', required=True, type=Path)
    parser.add_argument('--jdk', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    server, output = args.server.resolve(), args.output.resolve()
    assert not output.exists() and server not in output.parents and output != server
    root = Path(__file__).resolve().parents[1]
    eye = root.parent / 'CortiEyeMirror'
    for name, digest in BASES.items():
        assert sha(server / 'plugins' / name) == digest, name
    output.mkdir(parents=True)
    classes, empty = output / 'classes', output / 'empty'
    classes.mkdir(); empty.mkdir()
    names = ('ProtectionAdvisor', 'TaskRoutes', 'TaskMarketManager', 'LifeChallenges', 'AgentMessagePolicy')
    sources = [*(root / f'src/org/afuhome/agentfriend/{name}.java' for name in names if name != 'TaskMarketManager'),
               eye / 'src/org/afuhome/cortieye/MachineChatReceipts.java',
               eye / 'test/org/afuhome/cortieye/MachineChatReceiptsTest.java',
               root / 'tests/org/afuhome/agentfriend/AgentMessagePolicyTest.java']
    cp = os.pathsep.join(str(p) for p in [server / 'versions/1.21.1/paper-1.21.1.jar',
            *sorted((server / 'libraries').rglob('*.jar')), *sorted((server / 'plugins').glob('*.jar'))])
    # The current TaskMarket source also contains an unreleased parry change.
    # Reproduce the deployed class from its published source before applying
    # just the two spectator-recipient removals. Never include that future work.
    published = '838b0c8a4cb726f802c3880ea8a3682a709a68e4'
    market_path = 'paper/plugins/AgentFriend/src/org/afuhome/agentfriend/TaskMarketManager.java'
    market_bytes = subprocess.check_output(['git', 'show', published + ':' + market_path], cwd=root.parents[2])
    assert hashlib.sha256(market_bytes).hexdigest() == '01de50c73b0680e65c8c7b95738abb5024a91caf443d72e08a6901985eadd7c7'
    market_text = market_bytes.decode('utf8')
    baseline_source = output / 'source-baseline/org/afuhome/agentfriend/TaskMarketManager.java'
    baseline_source.parent.mkdir(parents=True); baseline_source.write_text(market_text, encoding='utf8', newline='\n')
    baseline_classes = output / 'baseline-classes'; baseline_classes.mkdir()
    baseline_args = ['-proc:none', '-encoding', 'UTF-8', '--release', '21', '-sourcepath', str(empty),
                     '-cp', cp, '-d', str(baseline_classes), str(baseline_source)]
    baseline_argfile = output / 'baseline-javac.args'
    baseline_argfile.write_text('\n'.join('"' + v.replace('\\', '/') + '"' for v in baseline_args), encoding='utf8')
    subprocess.run([str(args.jdk / 'bin/javac.exe'), '@' + str(baseline_argfile)], check=True)
    javap = args.jdk / 'bin/javap.exe'
    for built in baseline_classes.rglob('*.class'):
        qualified = built.relative_to(baseline_classes).as_posix().removesuffix('.class').replace('/', '.')
        def bytecode(classpath):
            return subprocess.check_output([str(javap), '-p', '-c', '-classpath', str(classpath), qualified])
        assert bytecode(baseline_classes) == bytecode(server / 'plugins/AgentFriend-0.4.47.9.jar'), qualified
    old = 'if (guide != null) {if(!plugin.communication().compact(player))showGuidance(player,guide);else for(Player eye:plugin.attachedEyes(player))showGuidance(eye,guide);}'
    new = 'if (guide != null) {if(!plugin.communication().compact(player))showGuidance(player,guide);}'
    extra = '        for (Player eye : plugin.attachedEyes(player)) eye.sendMessage(human);\n'
    assert market_text.count(old) == 1 and market_text.count(extra) == 1
    market_text = market_text.replace(old, new).replace(extra, '')
    generated_market = output / 'source/org/afuhome/agentfriend/TaskMarketManager.java'
    generated_market.parent.mkdir(parents=True); generated_market.write_text(market_text, encoding='utf8', newline='\n')
    sources.append(generated_market)
    params = ['-proc:none', '-encoding', 'UTF-8', '--release', '21', '-sourcepath', str(empty),
              '-cp', cp, '-d', str(classes), *map(str, sources)]
    argfile = output / 'javac.args'
    argfile.write_text('\n'.join('"' + v.replace('\\', '/') + '"' for v in params), encoding='utf8')
    subprocess.run([str(args.jdk / 'bin/javac.exe'), '@' + str(argfile)], check=True)
    subprocess.run([str(args.jdk / 'bin/java.exe'), '-ea', '-cp', str(classes) + os.pathsep + cp,
                    'org.afuhome.cortieye.MachineChatReceiptsTest'], check=True)
    subprocess.run([str(args.jdk / 'bin/java.exe'), '-ea', '-cp', str(classes) + os.pathsep + cp,
                    'org.afuhome.agentfriend.AgentMessagePolicyTest'], check=True)
    reports = []
    for name, old_version, new_version, package, class_names in [
            ('AgentFriend', '0.4.47.9', '0.4.47.10', 'org/afuhome/agentfriend', names),
            ('CortiEyeMirror', '0.1.16', '0.1.17', 'org/afuhome/cortieye', ('MachineChatReceipts',))]:
        before = server / 'plugins' / f'{name}-{old_version}.jar'
        target = output / f'{name}-{new_version}.jar'
        def owned(n):
            return n.startswith(package + '/') and n.endswith('.class') and n.rsplit('/', 1)[-1].split('$')[0].removesuffix('.class') in class_names
        with zipfile.ZipFile(before) as original, zipfile.ZipFile(target, 'x', zipfile.ZIP_DEFLATED) as result:
            assert len(original.namelist()) == len(set(original.namelist()))
            old_classes = {n for n in original.namelist() if owned(n)}
            new_classes = {p.relative_to(classes).as_posix(): p.read_bytes() for p in classes.rglob('*.class')
                           if owned(p.relative_to(classes).as_posix())}
            assert set(new_classes) == old_classes, (name, old_classes, set(new_classes))
            for info in original.infolist():
                data = original.read(info.filename)
                if owned(info.filename): data = new_classes[info.filename]
                elif info.filename == 'plugin.yml':
                    text = data.decode('utf8')
                    assert text.count(f"version: '{old_version}'") == 1
                    data = text.replace(f"version: '{old_version}'", f"version: '{new_version}'").encode('utf8')
                result.writestr(info, data)
        with zipfile.ZipFile(before) as original, zipfile.ZipFile(target) as result:
            assert set(original.namelist()) == set(result.namelist())
            changed = [n for n in original.namelist() if original.read(n) != result.read(n)]
            assert all(n == 'plugin.yml' or owned(n) for n in changed)
            assert any(owned(n) for n in changed)
        reports.append({'version': new_version, 'file': target.name, 'sha256': sha(target),
                        'baselineSha256': sha(before), 'changedEntries': changed,
                        'unrelatedEntriesByteIdentical': len(original.namelist()) - len(changed)})
    record = {'productionChanged': False, 'jars': reports,
              'publishedTaskMarketSource': published, 'taskMarketBaselineBytecodeIdentical': True,
              'taskMarketGeneratedSha256': sha(generated_market),
              'sources': {p.relative_to(root.parent).as_posix(): sha(p) for p in sources if p != generated_market}}
    (output / 'build.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf8')
    print(json.dumps(record))

if __name__ == '__main__': main()
