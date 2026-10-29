"""Bound structured planner previews without discarding the actual outcome.

Original receipts and controller decisions remain untouched. Omitted values are
absent and explicitly listed; a preview never interprets missing data as empty.
"""
import json

from .observations import fact_preview, spatial_text


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


PRIORITY = ('status', 'ok', 'failed', 'reason', 'code', 'outcomeKnown', 'outcomeUnknown',
            'changed', 'goalCompleted', 'goal_completed', 'requestId', 'request_id',
            'bodyId', 'playerUuid', 'observedAt', 'serverEpoch', 'operation',
            'response', 'serverReceipt', 'result', 'receipt', 'outcome', 'next_safe_read')
MISSING = object()


def typed_receipt_preview(value):
    """Only project typed results; prose-only tools keep their existing preview."""
    if not isinstance(value.get('data'), dict):
        return None
    for text_bytes, array_limit, string_bytes, depth_limit, property_limit in (
            (1400, 3, 320, 6, 24), (900, 2, 180, 5, 16), (500, 1, 100, 4, 12)):
        omitted = []

        def note(path, reason, **counts):
            omitted.append({'path': path, 'reason': reason, **counts})

        def project(item, path, depth=0):
            if isinstance(item, str):
                if len(item.encode()) <= string_bytes:
                    return item
                note(path, 'string_preview', originalBytes=len(item.encode()))
                return fact_preview(item, string_bytes)
            if item is None or type(item) in {int, float, bool}:
                return item
            # Preserve small exact invocation links, coordinates and identifiers,
            # even inside a deeper result. This is size-based, not mod-specific.
            if len(encoded(item).encode()) <= 500:
                return item
            if depth >= depth_limit:
                note(path, 'depth_budget')
                return MISSING
            if isinstance(item, list):
                result = []
                for i, child in enumerate(item[:array_limit]):
                    shown = project(child, path + '/' + str(i), depth + 1)
                    if shown is MISSING:
                        # Preserve index meaning. Omit the whole array instead of
                        # moving later entries into the omitted entry's index.
                        note(path, 'array_index_budget', originalCount=len(item))
                        return MISSING
                    result.append(shown)
                if len(item) > len(result):
                    note(path, 'array_preview', originalCount=len(item), retainedCount=len(result))
                return result
            if isinstance(item, dict):
                result = {}
                order = {key: i for i, key in enumerate(PRIORITY)}
                keys = sorted(item, key=lambda k: (order.get(k, len(order)), isinstance(item[k], (dict, list))))
                for key in keys[:property_limit]:
                    child_path = path + '/' + str(key).replace('~', '~0').replace('/', '~1')
                    child = project(item[key], child_path, depth + 1)
                    if child is not MISSING:
                        result[key] = child
                if len(keys) > property_limit:
                    note(path, 'property_preview', originalCount=len(keys), retainedCount=min(property_limit, len(result)))
                return result
            note(path, 'unsupported_value')
            return MISSING

        result = {key: value[key] for key in ('failed', 'dispatched', 'origin', 'code', 'endsTurn') if key in value}
        text = spatial_text(value.get('text', ''))
        result['text'] = fact_preview(text, text_bytes)
        if result['text'] != text:
            note('/text', 'text_preview', originalBytes=len(text.encode()))
        for key in ('execution', 'data', 'meta'):
            if key in value:
                child = project(value[key], '/' + key)
                if child is not MISSING:
                    result[key] = child
        result['preview'] = {'protocol': 'agent-mc-receipt-preview/v1', 'complete': False,
                             'omitted': omitted[:24], 'omittedPathCount': len(omitted),
                             'interpretation': 'Dated partial preview; absent fields are not empty or successful. Read original chunks for omitted values.'}
        if len(encoded(result).encode()) <= 5200:
            return result
    # Keep terminal/unknown flags even for adversarially large metadata. Native
    # identity and the full payload remain in the archived original, never fake.
    minimal = {key: result[key] for key in ('failed', 'dispatched', 'origin', 'code', 'text', 'preview') if key in result}
    def flags(item):
        return {key: item[key] for key in PRIORITY if key in item
                and not isinstance(item[key], (dict, list)) and len(encoded(item[key]).encode()) <= 220}
    minimal['data'] = flags(value['data'])
    for key in ('response', 'serverReceipt', 'result', 'receipt', 'outcome'):
        if isinstance(value['data'].get(key), dict):
            minimal['data'][key] = flags(value['data'][key])
    if isinstance(value.get('execution'), dict):
        minimal['execution'] = {key: value['execution'][key] for key in
            ('kind', 'id', 'phase', 'terminal', 'goalCompleted') if key in value['execution']}
    minimal.update(dataUnavailable=True, dataUnavailableReason='structured_preview_budget')
    return minimal
