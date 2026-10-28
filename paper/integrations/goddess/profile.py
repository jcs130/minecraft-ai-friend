"""Pure planner for native QwenPaw job updates. No network or runtime mutation."""
from copy import deepcopy
import json
from pathlib import Path


def plan_jobs(existing, definitions=None):
    definitions = definitions or json.loads(Path(__file__).with_name('evolution-jobs.json').read_text(encoding='utf-8'))
    aliases = {spec.get('name', old): old for old, spec in definitions.items()}
    seen = set()
    result = []
    for original in existing:
        name = original['name']
        key = name if name in definitions else aliases.get(name)
        if key is None:
            result.append(deepcopy(original))
            continue
        if key in seen:
            raise ValueError('duplicate managed job: ' + key)
        seen.add(key)
        spec = definitions[key]
        job = deepcopy(original)
        job['name'] = spec.get('name', name)
        job['text'] = spec['text']
        job['request']['input'] = [{'role': 'user', 'type': 'message', 'content': [{'type': 'text', 'text': spec['text']}]}]
        job['runtime']['timeout_seconds'] = spec['timeout']
        job['runtime']['share_session'] = spec['shareSession']
        if spec.get('cron'):
            job['schedule']['cron'] = spec['cron']
        result.append(job)
    if seen != set(definitions):
        raise ValueError('missing managed jobs: ' + ', '.join(sorted(set(definitions) - seen)))
    return result


def plan_chat_review(existing, definition=None):
    """One dedicated native job; the original six specs are never modified here."""
    definition = definition or json.loads(Path(__file__).with_name('chat-review-job.json').read_text(encoding='utf-8'))
    matches = [j for j in existing if j['name'] == definition['name']]
    if len(matches) > 1:
        raise ValueError('duplicate public-chat review jobs')
    templates = matches or [j for j in existing if j['name'] == 'qiandengji-daily-patrol']
    if len(templates) != 1:
        raise ValueError('one original native Goddess patrol identity is required')
    job = deepcopy(templates[0])
    if not matches:
        job['id'] = None
        job['meta'] = {'managedBy': 'goddess-chat-review', 'revision': 1}
    job['name'], job['task_type'], job['text'] = definition['name'], 'agent', definition['text']
    job['enabled'] = matches[0]['enabled'] if matches else True
    job['schedule'] = {'type': 'cron', 'cron': definition['cron'], 'timezone': 'Asia/Shanghai'}
    job['request']['input'] = [{'role': 'user', 'type': 'message', 'content': [{'type': 'text', 'text': definition['text']}]}]
    job['runtime'].update(max_concurrency=1, timeout_seconds=definition['timeout'],
                          misfire_grace_seconds=60, share_session=False)
    job['dispatch']['silent'] = True
    job['save_result_to_inbox'] = False
    return job


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists():
        parser.error('output already exists; preserve previous plan')
    result = plan_jobs(json.loads(args.before.read_text(encoding='utf-8-sig')))
    with args.out.open('x', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(json.dumps({'status': 'planned', 'jobs': len(result), 'applied': False}))
