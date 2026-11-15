"""Build the fixed nearby-dialogue window on the verified 0.1.34 bridge."""
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
    if build.digest(args.baseline) != 'bae659e41e5b4d09a37b403b6943f67896bb6b52717a489df3f61cde75ca769a':
        parser.error('Expected the verified 0.1.34 autonomous companion artifact')
    names = ('HybridMaidPlugin', 'MaidConversationWindow', 'NativeMaidNearbyChat')
    package = 'local/tlmcompat/hybrid/'
    classpath = os.pathsep.join((str(args.baseline.resolve()), args.classpath_file.read_text(encoding='utf-8-sig').strip()))
    args.output.mkdir()
    classes = args.output / 'classes'
    build.compile_sources(args.jdk, classes, classpath,
                          [source / 'hybrid-src' / package / (name + '.java') for name in names])
    version = '0.1.35-dialogue-quiet'
    build.package(args.baseline, args.output / f'QiandengjiMaidBridge-{version}.jar',
                  classes, package, names, version)


if __name__ == '__main__':
    main()
