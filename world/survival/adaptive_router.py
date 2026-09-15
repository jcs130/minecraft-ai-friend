"""Adaptive LLM invocation router: decide when thinking is actually needed.

Four levels (Kahneman dual-system adapted for embodied Minecraft agent):
  Level 0 (SKIP):   Familiar situation, cached policy suffices. Zero LLM cost.
  Level 1 (FAST):   Minor environmental delta. Quick check, tiny model or heuristic.
  Level 2 (THINK):  Routine decision cycle. Current model behavior, unchanged.
  Level 3 (PLAN):   Novel/complex/uncertain. Full reasoning, batch planning.

This module scores uncertainty and returns a routing decision. It never
executes actions or calls models — it is a pure function consumed by the
controller's tick() before submit_model().

Designed for lazy integration: the controller checks route.level first;
if < 2 it can skip the LLM call and use route.suggested_action instead.
"""
import json
import math
import os
import re
import time
from pathlib import Path

# --- Uncertainty signals (each returns 0.0–1.0) ---

def _novelty_score(perception: dict) -> float:
    """How unfamiliar is the current environment? High if new biome,
    unvisited chunk, unusual mob presence, or missing known landmarks."""
    score = 0.0
    biome = perception.get('biome', '')
    known_biomes = perception.get('known_biomes', [])
    if biome and biome not in known_biomes:
        score += 0.3
    hostile_count = perception.get('nearby_hostiles', 0)
    if hostile_count >= 3:
        score += 0.2
    elif hostile_count > 0:
        score += 0.1
    unknown_blocks = perception.get('unknown_blocks_nearby', 0)
    if unknown_blocks > 5:
        score += 0.15
    dimension = perception.get('dimension', 'overworld')
    if dimension != 'overworld':
        score += 0.2
    return min(1.0, score)


def _failure_rate(recent_receipts: list) -> float:
    """Ratio of failed actions in the last N receipts."""
    if not recent_receipts:
        return 0.0
    failed = sum(1 for r in recent_receipts if r.get('status') in ('failed', 'rejected', 'unknown'))
    return failed / len(recent_receipts)


def _goal_progress(perception: dict, goals: dict) -> float:
    """Is the current goal close to completion? Low progress = high uncertainty
    about what to do next."""
    target = goals.get('current_target', '')
    inventory = perception.get('inventory_summary', {})
    if not target:
        return 0.5  # No goal = moderate uncertainty
    target_item = goals.get('target_item', '')
    if target_item:
        have = inventory.get(target_item, 0)
        need = goals.get('target_count', 1)
        if have >= need:
            return 0.1  # Goal achieved, low uncertainty
        return max(0.1, 1.0 - have / need)
    return 0.3  # Non-item goal, assume moderate


def _environment_delta(current: dict, last_known: dict) -> float:
    """How much has the environment changed since the last observation?
    Large deltas (combat started, HP dropped, party message) need attention."""
    delta = 0.0
    hp_now = current.get('hp', 20)
    hp_before = last_known.get('hp', 20)
    if hp_now < hp_before - 3:
        delta += 0.3
    if hp_now < 8:
        delta += 0.2
    if current.get('under_attack', False):
        delta += 0.35
    if current.get('party_message_pending', False):
        delta += 0.20
    if current.get('inventory_changed_significantly', False):
        delta += 0.10
    return min(1.0, delta)


def _time_since_last_plan(last_plan_at: float, now: float) -> float:
    """Long time without a plan = accumulated drift. But very recent plan
    means we're still executing and don't need to re-think."""
    elapsed = now - last_plan_at
    if elapsed < 30:
        return 0.0   # Just planned, still executing
    if elapsed < 120:
        return 0.3   # 1-2 min, probably fine
    if elapsed < 300:
        return 0.6   # 5 min, should check in
    return 0.9       # >5 min, definitely overdue


def _skill_coverage(perception: dict, available_skills: list) -> float:
    """Does a programmed skill already handle this situation?
    High coverage = low uncertainty (System 1 can handle it)."""
    current_activity = perception.get('current_activity', '')
    for skill in available_skills:
        if skill.get('triggers', '') and current_activity in skill.get('triggers', ''):
            return 1.0
    return 0.0


# --- Composite router ---

WEIGHTS = {
    'novelty': 0.25,
    'failure_rate': 0.20,
    'goal_progress': 0.15,
    'env_delta': 0.25,
    'time_drift': 0.10,
    'skill_coverage': -0.15,  # Negative: high coverage REDUCES uncertainty
}

LEVELS = {
    0: {'name': 'SKIP', 'description': 'Familiar situation, cached policy or programmed skill suffices', 'max_llm': 'none'},
    1: {'name': 'FAST', 'description': 'Minor delta, quick heuristic check', 'max_llm': 'tiny'},
    2: {'name': 'THINK', 'description': 'Routine decision, current model behavior', 'max_llm': 'standard'},
    3: {'name': 'PLAN', 'description': 'Novel/complex, full reasoning + batch planning', 'max_llm': 'unlimited'},
}


def route(perception: dict, history: dict, goals: dict, skills: list,
          last_plan_at: float = 0, now: float = None) -> dict:
    """Pure function: return routing decision with level, reason, and suggestion.

    The controller calls this before submit_model(). If level < 2,
    the controller may skip the LLM call entirely.
    """
    if now is None:
        now = time.time()

    signals = {
        'novelty': _novelty_score(perception),
        'failure_rate': _failure_rate(history.get('recent_receipts', [])),
        'goal_progress': _goal_progress(perception, goals),
        'env_delta': _environment_delta(perception, history.get('last_perception', {})),
        'time_drift': _time_since_last_plan(last_plan_at, now),
        'skill_coverage': _skill_coverage(perception, skills),
    }

    composite = sum(WEIGHTS[k] * v for k, v in signals.items())
    composite = max(0.0, min(1.0, composite))

    # Hard floors: any single strong signal guarantees at least THINK level
    # (prevents composite dilution when one signal is critical but others are calm)
    if signals['env_delta'] >= 0.25:
        composite = max(composite, 0.45)
    if signals['novelty'] >= 0.25:
        composite = max(composite, 0.40)
    if signals['time_drift'] >= 0.7:
        composite = max(composite, 0.40)

    # Hard overrides (safety first — these ALWAYS escalate)
    if perception.get('hp', 20) < 6:
        composite = 1.0
        reason = 'CRITICAL_HP'
    elif perception.get('under_attack', False) and signals['novelty'] > 0.3:
        composite = max(composite, 0.8)
        reason = 'COMBAT_NOVEL'
    elif perception.get('party_message_pending', False):
        composite = max(composite, 0.7)
        reason = 'PARTY_PENDING'
    elif signals['failure_rate'] > 0.5:
        composite = max(composite, 0.85)
        reason = 'REPEATED_FAILURE'
    else:
        reason = 'composite'

    # Map composite score to level
    if composite < 0.15:
        level = 0
    elif composite < 0.30:
        level = 1
    elif composite < 0.55:
        level = 2
    else:
        level = 3

    # Suggest an action for level 0/1 (so the controller can skip LLM)
    suggestion = None
    if level == 0:
        if perception.get('current_activity') == 'farming':
            suggestion = 'continue_farming_skill'
        elif perception.get('goto_in_progress', False):
            suggestion = 'continue_goto'
        else:
            suggestion = 'repeat_last_action'
    elif level == 1:
        suggestion = 'quick_status_check'

    return {
        'level': level,
        'level_name': LEVELS[level]['name'],
        'score': round(composite, 3),
        'reason': reason,
        'signals': {k: round(v, 3) for k, v in signals.items()},
        'suggested_action': suggestion,
        'should_call_llm': level >= 2,
        'at': now,
    }
