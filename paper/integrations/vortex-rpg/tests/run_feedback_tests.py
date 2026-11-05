"""Run actual spell/status handlers with API doubles, never a Minecraft connection.

The private classpath file lists one existing candidate classes/JAR path per line.
Include compiled AgentFriend and RPG bridge classes, their locked API dependencies,
Mockito 5.14.2, Byte Buddy 1.15.4/agent and Objenesis 3.3. No downloads or installation.
"""
import argparse
import os
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('jdk', 'classpath-file', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    paths = [Path(s).resolve() for s in args.classpath_file.read_text(encoding='utf-8-sig').splitlines() if s.strip()]
    if not paths or not all(p.exists() for p in paths):
        raise ValueError('existing_candidate_classpath_required')
    output = args.output.resolve()
    if output.exists() or any(p == output or p in output.parents for p in paths if p.is_dir()):
        raise ValueError('fresh_output_outside_inputs_required')
    agents = [p for p in paths if p.name == 'byte-buddy-agent-1.15.4.jar']
    if len(agents) != 1:
        raise ValueError('one_explicit_byte_buddy_agent_required')
    root = Path(__file__).resolve().parents[1]
    sources = [root / 'tests/ActiveEffectsFeedbackTest.java',
               root.parents[1] / 'plugins/AgentFriend/tests/org/afuhome/agentfriend/FoodCastFeedbackTest.java']
    output.mkdir(parents=True)
    suffix = '.exe' if os.name == 'nt' else ''
    jdk = args.jdk / 'bin'
    cp = os.pathsep.join(map(str, paths))
    options = ['-proc:none', '--release', '21', '-encoding', 'UTF-8', '-cp', cp, '-d', str(output), *map(str, sources)]
    argfile = output / 'compile.args'
    argfile.write_text('\n'.join('"' + s.replace('\\', '/').replace('"', '\\"') + '"' for s in options), encoding='utf-8')
    subprocess.run([str(jdk / ('javac' + suffix)), '@' + str(argfile)], check=True, timeout=120)
    for test in ['org.afuhome.agentfriend.FoodCastFeedbackTest', 'org.qiandengji.vortex.ActiveEffectsFeedbackTest']:
        subprocess.run([str(jdk / ('java' + suffix)), '-Dfile.encoding=UTF-8', '-javaagent:' + str(agents[0]),
                        '-cp', str(output) + os.pathsep + cp, test], check=True, timeout=60)
    print('feedback tests passed; realGame=false; productionChanged=false')


if __name__ == '__main__':
    main()
