"""Install the initial skill bundle during a drained, idle maintenance boundary."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
from numen_gateway import action_lock, read_json
from skill_library import SkillLibrary
from starter_skills import bundle, install


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not args.apply:
        result = {'apply': False, 'programs': [{'name': r['name'], 'automatic': 'routing' in r} for r in bundle()]}
    else:
        with action_lock(args.state):
            control = read_json(args.state / 'control.json')
            controller = read_json(args.state / 'controller.json')
            lease = read_json(args.state / 'lease.json')
            job_path = args.state / 'skill-job.json'
            job = read_json(job_path) if job_path.exists() else {}
            if (control.get('enabled') is not False or controller.get('active') or controller.get('dialogueActive')
                    or lease.get('status') in ('open', 'used', 'unknown') or (args.state / 'unknown.json').exists()
                    or job.get('status') in ('pending', 'running', 'dispatching')
                    or job.get('practiceStarted') and not job.get('practiceFinalized')):
                raise ValueError('drained_idle_maintenance_required')
            library = SkillLibrary(args.state / 'skills')
            result = {'apply': True, 'programs': install(library), 'worldActions': 0, 'modelCalls': 0}
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps({'programs': len(result['programs']), 'applied': args.apply}))


if __name__ == '__main__':
    main()
