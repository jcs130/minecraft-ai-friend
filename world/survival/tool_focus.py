"""Small Jev advisory for a survivor turn; it grants no tool or body authority."""
import copy
import math


TOOL_GROUPS = {
    'motion': ('navigate_plan', 'navigate', 'view_scene', 'remember'),
    'survival': ('status', 'eat', 'equip', 'game_cast'),
    'inspect': ('status', 'view_scene', 'inspect_block', 'scan_blocks'),
    'work': ('craft', 'mine', 'place_block', 'open_container'),
    'social': ('say', 'party_send', 'say_status', 'remember'),
    'review': ('remember', 'read_file', 'write_file', 'skill_catalog'),
}

DESCRIPTIONS = {
    'motion': 'Continue the current physical goal: queue a multi-waypoint route or one nearby navigation target.',
    'survival': 'Current health, hunger, hostile threat, or equipment needs immediate attention before travel.',
    'inspect': 'The last route failed or terrain is uncertain; inspect the current first-person scene or exact blocks.',
    'work': 'The next useful progress is gathering, crafting, building, farming, or interacting with a container.',
    'social': 'A real audience or party event needs a short spoken response or a message to the companion.',
    'review': 'No immediate body step is indicated; review confirmed outcomes and update the current plan.',
}

GUIDANCE = {
    'motion': '已有行走或巡逻目标时，优先一次用navigate_plan排队2–6个安全路标；已知安全往返路线可设continue_while_thinking=true，成功后快循环接续折返。',
    'inspect': '先核对失败点和新鲜视野；若能安全续行，本轮接着排队连续路标，不把整轮只花在看图上。',
    'survival': '先处理当前危险或补给，再决定可持续执行的下一步。',
    'work': '选一个可核验的采集、制作或建设步骤交给快循环。',
    'social': '回应真实来信或现场变化；身体安全时仍推进当前任务。',
    'review': '核对真实回执，更新自己的计划和下一步。',
}


def _latest_outcome(context):
    queue = (context.get('motor') or {}).get('queue') or {}
    recent = queue.get('recent') or []
    return recent[-1] if isinstance(recent, list) and recent and isinstance(recent[-1], dict) else {}


def _facts(context, body):
    scene = (context.get('observations') or {}).get('scene') or {}
    queue = (context.get('motor') or {}).get('queue') or {}
    outcome = _latest_outcome(context)
    receipt = outcome.get('receipt') or {}
    last_code = receipt.get('code') or receipt.get('reason')
    if not isinstance(last_code, (str, int, float, bool)):
        last_code = None
    elif isinstance(last_code, str):
        last_code = last_code[:120]
    return {
        'position': copy.deepcopy(body.get('position')),
        'hp': body.get('hp'), 'hunger': body.get('hunger'),
        'sceneFresh': scene.get('fresh') is True,
        'hostiles': min(20, len((context.get('scene') or {}).get('hostiles') or [])),
        'goalState': (context.get('intent') or {}).get('goalState'),
        'lastMotor': {key: outcome.get(key) for key in ('kind', 'status')},
        'lastCode': last_code,
        'uncertainMotor': min(6, sum(row.get('status') == 'unknown' for row in
                                    (queue.get('recent') or []) + (queue.get('active') or [])
                                    if isinstance(row, dict))),
        'requestedReview': bool(context.get('review')),
        'partyMessage': bool(context.get('partyMessage')),
    }


def proposal(context, body):
    facts = _facts(context, body)
    return {'question': 'Which tool family should the slow Minecraft agent consider first from current verified facts? '
            'This is advice only: choose the most urgent useful family, not an action to execute.',
            'candidates': [{'id': key, 'description': description, 'action': None}
                           for key, description in DESCRIPTIONS.items()],
            'context': facts}


def fallback_category(context, body):
    facts = _facts(context, body)
    if facts['partyMessage']:
        return 'social'
    if facts['uncertainMotor']:
        return 'inspect'
    if (type(facts['hp']) in (int, float) and facts['hp'] <= 8
            or type(facts['hunger']) in (int, float) and facts['hunger'] <= 4
            or facts['hostiles']):
        return 'survival'
    if facts['lastMotor']['status'] == 'failed':
        return 'inspect'
    if facts['requestedReview']:
        return 'review'
    return 'motion'


def summarize(selection, context, body, *, current=True):
    choice = selection.get('choice') if isinstance(selection, dict) else None
    confidence = selection.get('confidence') if isinstance(selection, dict) else None
    # This is a reading hint, never permission to act. A weaker Jev vote is
    # still useful to the slow agent, which sees the underlying facts too.
    code = selection.get('code') if isinstance(selection, dict) else None
    trusted = (current and code not in ('policy_observation_stale', 'policy_unavailable',
                                       'policy_state_too_large')
               and choice in TOOL_GROUPS and type(confidence) in (int, float)
               and math.isfinite(confidence) and confidence >= .4)
    category = choice if trusted else fallback_category(context, body)
    facts = _facts(context, body)
    if facts['uncertainMotor'] and category != 'inspect':
        category, trusted = 'inspect', False
    # The configured native and MCP tools remain enabled. This list is a
    # reading order for Qwen, not a whitelist or action permission.
    latency = selection.get('latencyMs') if isinstance(selection, dict) else None
    return {'source': 'jev' if trusted else 'local_fallback', 'category': category,
            'confidence': round(confidence, 3) if trusted else None,
            'jevChoice': choice if choice in TOOL_GROUPS else None,
            'jevConfidence': round(confidence, 3) if type(confidence) in (int, float)
                and math.isfinite(confidence) and 0 <= confidence <= 1 else None,
            'jevCode': selection.get('code') if isinstance(selection, dict) else None,
            'premiseCurrent': bool(current),
            'latencyMs': round(latency, 2) if type(latency) in (int, float)
                and math.isfinite(latency) and latency >= 0 else None,
            'recommendedTools': list(TOOL_GROUPS[category]),
            'keyFacts': facts, 'advisoryOnly': True,
            'instruction': ('存在未确认的身体动作，先用status核对，不重复提交同一动作。' if facts['uncertainMotor'] else '')
                + GUIDANCE[category] + '所有已启用工具仍可按需要使用；回执才证明动作结果。'}
