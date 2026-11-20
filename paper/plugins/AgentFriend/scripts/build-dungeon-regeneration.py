"""Build the room-regeneration increment for the reviewed production AgentFriend jar on Windows."""
import argparse
import os
import runpy
from pathlib import Path

BASE_SHA256 = 'c866fe087da112eff6284b4fb4edd8bc761063e1f2df8f5d37cc7b8710e1864c'
VERSION = '0.4.54-dungeon-regeneration'
CLASSES = (
    'ActionFeedback', 'AgentFriendPlugin', 'ConquestWorld', 'DungeonAdvice', 'DungeonBuildPolicy',
    'DungeonEditJournal', 'DungeonIntegrity', 'DungeonManager', 'GeneratedStructureProtection',
    'LandManager', 'ProtectionAdvisor', 'ProtectionArea', 'ProtectionChat', 'ProtectionQuery',
    'RuinIdleTimer', 'SiteDungeonManager', 'WildRuinResets',
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, required=True, help='Installed AgentFriend jar')
    parser.add_argument('--jdk', type=Path, required=True, help='JDK 21 home')
    parser.add_argument('--classpath-file', type=Path, required=True,
                        help='UTF-8 file listing one dependency jar path per line, in javac resolution order')
    parser.add_argument('--output', type=Path, required=True, help='A fresh build directory')
    args = parser.parse_args()
    helpers = runpy.run_path(str(Path(__file__).with_name('build-dungeon-readiness.py')))
    if helpers['digest'](args.base) != BASE_SHA256:
        parser.error('The AgentFriend base differs from the reviewed release')
    if args.output.exists():
        parser.error('Choose a new output directory')
    dependencies = [Path(line) for line in args.classpath_file.read_text(encoding='utf-8-sig').splitlines() if line]
    if not dependencies or not all(jar.is_file() for jar in dependencies):
        parser.error('Every classpath entry must be an existing jar')
    cp = os.pathsep.join(str(jar.resolve()) for jar in [args.base, *dependencies])
    folder = Path(__file__).resolve().parents[1] / 'src' / 'org' / 'afuhome' / 'agentfriend'
    classes = args.output / 'classes'
    helpers['compile_sources'](args.jdk, classes, cp, [folder / (name + '.java') for name in CLASSES])
    helpers['package'](args.base, args.output / ('AgentFriend-' + VERSION + '.jar'), classes,
                       'org/afuhome/agentfriend/', CLASSES, VERSION)


if __name__ == '__main__':
    main()
