"""Start QwenPaw in this process so its native cron executor retains the guard."""
import argparse
from cron_guard import install


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', choices=('game', 'operations'), required=True)
    args = parser.parse_args()
    install(args.runtime)
    from qwenpaw.cli.main import cli
    cli(args=['app', '--host', '0.0.0.0', '--port', '8088', '--log-level', 'info'], prog_name='qwenpaw')


if __name__ == '__main__': main()
