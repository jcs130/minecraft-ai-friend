"""Preview, or explicitly apply, only Kirito's 6 -> 12 model-iteration change.

Uses QwenPaw's native running-config endpoint and its scheduled role reload.
No provider/model settings, tasks, history, controller budgets or body actions
are written. Keep the controller paused until the operator verifies readiness.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
from role_learning_profiles import SURVIVOR_MAX_ITERS, SURVIVOR_QPM
from exercise_minecraft_knowledge import NoRedirect, protected, require, save

ROLE = 'qd-survivor'
ROUTE = '/workspace/running-config'


def api(route, payload=None):
    require(route in (ROUTE, '/agents/' + ROLE, '/agents/' + ROLE + '/agent-status'), 'invalid_route')
    require(payload is None or route == ROUTE, 'only_running_config_write_allowed')
    request = urllib.request.Request('http://127.0.0.1:18089/api' + route,
        data=None if payload is None else json.dumps(payload).encode('utf-8'),
        method='GET' if payload is None else 'PUT',
        headers={'X-Agent-Id': ROLE, 'Content-Type': 'application/json'})
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=30) as response:
        raw = response.read(1024 * 1024 + 1)
    require(len(raw) <= 1024 * 1024, 'response_too_large')
    return json.loads(raw)


def candidate(running):
    require(running.get('llm_max_qpm') == SURVIVOR_QPM and running.get('llm_max_concurrent') == 1,
            'unexpected_qpm_or_concurrency')
    require(running.get('llm_retry_enabled') is False, 'unexpected_retry_policy')
    iteration = running['loop']['iteration']
    require(iteration.get('enabled') is True and running.get('max_iters') == iteration.get('max_iterations')
            and type(running.get('max_iters')) is int and running['max_iters'] in (6, SURVIVOR_MAX_ITERS),
            'unexpected_iteration_config')
    value = deepcopy(running)
    value['max_iters'] = SURVIVOR_MAX_ITERS
    value['loop']['iteration']['max_iterations'] = SURVIVOR_MAX_ITERS
    return value


def apply(*, execute=False, root=ROOT, call=api):
    before_state = protected(root)
    require(before_state['paused'] and not before_state['activeDecision'], 'survivor_must_be_paused_and_idle')
    require(call('/agents/' + ROLE + '/agent-status').get('running_task_count') == 0, 'role_busy')
    profile = call('/agents/' + ROLE)
    require(profile.get('id') == ROLE, 'wrong_role')
    running = call(ROUTE)
    updated = candidate(running)
    result = {'ok': True, 'role': ROLE, 'executed': False, 'from': running['max_iters'],
              'to': SURVIVOR_MAX_ITERS, 'qpm': SURVIVOR_QPM, 'concurrency': 1,
              'modelTasksSubmitted': 0, 'bodyActionsSubmitted': 0}
    if not execute or running == updated:
        return {**result, 'alreadyConfigured': running == updated}
    # The endpoint replaces only running; use its current complete response.
    # Recheck immediately before the one PUT; never resend after an uncertain result.
    require(protected(root) == before_state, 'controller_changed')
    require(call('/agents/' + ROLE + '/agent-status').get('running_task_count') == 0, 'role_busy')
    require(call(ROUTE) == running, 'running_config_changed')
    receipt = root / 'runtime' / ('survivor-model-iterations-' + str(SURVIVOR_MAX_ITERS) + '.json')
    require(not receipt.exists(), 'prior_update_receipt_exists_verify_before_retry')
    evidence = {'schema': 1, 'role': ROLE, 'state': 'unknown', 'runningBefore': running, 'runningAfter': updated}
    save(receipt, evidence)
    call(ROUTE, updated)
    actual = call(ROUTE)
    require(actual == updated, 'native_running_config_verification_failed')
    after_profile = call('/agents/' + ROLE)
    require({k: v for k, v in after_profile.items() if k != 'running'} ==
            {k: v for k, v in profile.items() if k != 'running'}, 'other_profile_fields_changed')
    require(protected(root) == before_state, 'controller_changed')
    evidence['state'] = 'verified'; save(receipt, evidence)
    return {**result, 'executed': True, 'receipt': str(receipt), 'otherProfileFieldsPreserved': True,
            'controllerStatePreserved': True, 'nativeRoleReloadScheduled': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', choices=['qiandengji'])
    args = parser.parse_args()
    print(json.dumps(apply(execute=bool(args.execute)), ensure_ascii=False))
