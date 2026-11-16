"""Compile and execute reservation/restart/failure tests without Minecraft or credentials."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jdk', type=Path, required=True)
    parser.add_argument('--gson', type=Path, required=True)
    args = parser.parse_args()
    suffix = '.exe' if os.name == 'nt' else ''
    with tempfile.TemporaryDirectory(prefix='maid-contract-test-') as directory:
        work = Path(directory)
        subprocess.run([str(args.jdk / 'bin' / ('javac' + suffix)), '--release', '21', '-encoding', 'UTF-8',
            '-cp', str(args.gson), '-d', str(work),
            str(ROOT / 'src/local/qdj/maids/brain/CompanionLedger.java'),
            str(ROOT / 'src/local/qdj/maids/brain/CompanionDecision.java'),
            str(ROOT / 'src/local/qdj/maids/brain/CompanionJournal.java'),
            str(ROOT / 'tests/CompanionLedgerTest.java')], check=True)
        subprocess.run([str(args.jdk / 'bin' / ('java' + suffix)), '-cp', str(work) + os.pathsep + str(args.gson),
            'local.qdj.maids.brain.CompanionLedgerTest', str(work / 'state')], check=True)


if __name__ == '__main__':
    main()
