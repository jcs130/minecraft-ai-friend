"""Build the scene-aware dialogue and combat voice on the verified 0.1.35 bridge."""
import argparse
from importlib.util import module_from_spec, spec_from_file_location
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('baseline', 'classpath-file', 'jdk', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    spec = spec_from_file_location('readiness_build', source.parents[1] / 'plugins/AgentFriend/scripts/build-dungeon-readiness.py')
    build = module_from_spec(spec)
    spec.loader.exec_module(build)
    if build.digest(args.baseline) != '19614119a381292d1039dbb36657958671c37dc21cef02334a43810f4438f035':
        parser.error('Expected the verified 0.1.35 residence recovery artifact')
    names = ('HybridMaidPlugin', 'MaidConversationWindow', 'NativeMaidNearbyChat', 'MaidCombatSpeech', 'NativeMaidSpeech', 'NativeMaidSocialSupport', 'NativeMaidCompanionSupport', 'NativeMaidBrainSupport')
    package = 'local/tlmcompat/hybrid/'
    classpath = os.pathsep.join((str(args.baseline.resolve()), args.classpath_file.read_text(encoding='utf-8-sig').strip()))
    args.output.mkdir()
    classes = args.output / 'classes'
    build.compile_sources(args.jdk, classes, classpath,
                          [source / 'hybrid-src' / package / (name + '.java') for name in names])
    version = '0.1.36-scene-speech'
    build.package(args.baseline, args.output / f'QiandengjiMaidBridge-{version}.jar',
                  classes, package, names, version)


if __name__ == '__main__':
    main()
