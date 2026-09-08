"""Consume a fixed next-day planning request in the existing NPC worker.

Requests authorize one professional Qwen planning task, never world actions.
Only the original quest publisher changes a new day's contract file.
"""
from datetime import date, timedelta
import json
import os
from pathlib import Path
import time

from npc_identity import contract_issuer, valid_position
from qwen_tasks import read_json, write_json


def tick(npc, planner, *, requests=None, public=None, today=None, clock=time.time):
    current = date.today() if today is None else today
    tomorrow = (current + timedelta(days=1)).isoformat()
    root = Path(requests or os.environ['NPC_WORLD_OPERATIONS_REQUESTS'])
    output = Path(public or os.environ['NPC_WORLD_PLANNING_PUBLIC'])
    village = Path(npc.VDIR)
    plan_path = village/'agent-plans'/(tomorrow+'.json')
    receipt_path = village/'world-operations-receipts'/(tomorrow+'.json')
    eligible = []
    for person in npc.PROFILES:
        if contract_issuer(person, 'gather'):
            try:
                if valid_position(npc.alive_pos(person)): eligible.append(person)
            except Exception: pass
    keys = sorted(p['key'] for p in eligible)
    existing = read_json(plan_path) if plan_path.exists() else None
    receipt = read_json(receipt_path) if receipt_path.exists() else None
    request_path = root/(tomorrow+'.json')
    if request_path.exists() and not receipt:
        if any(p.is_symlink() for p in (request_path, *request_path.parents)) or request_path.stat().st_size > 8192:
            raise ValueError('invalid_world_request_path')
        request = read_json(request_path)
        expected_keys = {'schema', 'project', 'purpose', 'day', 'requestId', 'requestedAt', 'eligibleIssuers'}
        if (set(request) != expected_keys or request.get('schema') != 1 or request.get('project') != 'qiandengji'
                or request.get('purpose') != 'guild-next-day' or request.get('day') != tomorrow
                or request.get('requestId') != 'world-guild-'+tomorrow
                or type(request.get('requestedAt')) not in (int, float)
                or not -5 <= clock()-request['requestedAt'] <= 86400
                or not isinstance(request.get('eligibleIssuers'), list)
                or any(not isinstance(k, str) for k in request['eligibleIssuers'])):
            raise ValueError('invalid_world_request')
        receipt = {'schema': 1, 'day': tomorrow, 'requestId': request['requestId'], 'observedAt': clock(),
                   'agentId': 'qd-guild-planner', 'status': 'claimed', 'worldActionsExecuted': 0}
        # A crash after this claim is uncertain. Further ticks collect only;
        # they never repeat a possibly-paid submission.
        write_json(receipt_path, receipt)
        if existing or (village/('quests-'+tomorrow+'.json')).exists():
            receipt['status'] = 'existing_plan_preserved'
        else:
            chosen = [p for p in eligible if p['key'] in request['eligibleIssuers']]
            if not chosen:
                receipt['status'] = 'no_online_qualified_issuers'
            else:
                try:
                    existing = planner.plan(tomorrow, chosen, submit=True)
                    receipt.update(status=existing['status'], taskId=existing.get('taskId'),
                                   selectedIssuers=sorted(p['key'] for p in chosen))
                except Exception as exc:
                    receipt.update(status='submission_unknown', errorType=type(exc).__name__)
        write_json(receipt_path, receipt)
    elif receipt and receipt.get('status') in ('claimed', 'submitted', 'running', 'poll_unavailable', 'submission_unknown'):
        # Collector owns polling and validation, using the original purpose/day
        # request file. This branch never POSTs or changes a historical plan.
        if existing:
            receipt.update(status=existing['status'], taskId=existing.get('taskId'), observedAt=clock())
            write_json(receipt_path, receipt)
    brief = None if not existing else {'status': existing.get('status'), 'questCount': len(existing.get('quests', {})),
                                      'agentId': existing.get('agentId')}
    published = village/('quests-'+current.isoformat()+'.json')
    publication = None
    if published.exists():
        doc = read_json(published)
        publication = {'day': current.isoformat(), 'status': 'published', 'questCount': len(doc.get('quests', [])),
                       'agentQuestCount': sum(q.get('source') == 'qwenpaw-agent' for q in doc.get('quests', []))}
    safe_receipt = None if not receipt else {k: receipt.get(k) for k in
        ('day', 'requestId', 'observedAt', 'agentId', 'status', 'selectedIssuers', 'worldActionsExecuted') if k in receipt}
    context = {'schema': 1, 'updatedAt': clock(), 'today': current.isoformat(), 'nextDay': tomorrow,
               'eligibleIssuers': keys, 'existingPlan': brief, 'receipt': safe_receipt,
               'publication': publication,
               'configuredVillageRoutines': sum(bool(p.get('routines')) for p in npc.PROFILES),
               'nativeWorkVerification': 'not_measured'}
    write_json(output, context)
    return context
