"""Exact native error classification and bounded cooldown metadata; no I/O."""
import math
import re


TRANSIENT_KINDS = frozenset(('provider_throttled', 'provider_concurrency'))
SUMMARIES = {
    'provider_throttled': '供应商短时限流，不代表套餐额度用尽',
    'provider_concurrency': '供应商当前并发受限',
    'provider_window_exhausted': '供应商套餐窗口额度已用尽',
    'local_queue_timeout': '本地模型队列等待超时',
    'unknown': '模型失败，现有错误信息不足以确定原因',
}


def classify_inference_error(error):
    """Read only native result.error code/message, never generated answer text."""
    error = error if isinstance(error, dict) else {}
    code, message = error.get('code'), error.get('message')
    code = code if isinstance(code, str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,96}', code) else None
    result = {'kind': 'unknown', 'summary': SUMMARIES['unknown'], 'code': code}
    if not isinstance(message, str) or not 1 <= len(message) <= 8192:
        return result
    message = ' '.join(message.lower().split())
    matches = []
    for prefix, kind in (('usage', 'provider_throttled'), ('concurrency', 'provider_concurrency'),
                         ('hour', 'provider_window_exhausted'), ('week', 'provider_window_exhausted'),
                         ('month', 'provider_window_exhausted')):
        if code == 'MODEL_QUOTA_EXCEEDED' and re.search(r'(?<![a-z_])' + prefix + r' allocated quota exceeded(?![a-z_])', message):
            matches.append((kind, prefix if kind == 'provider_window_exhausted' else None))
    if re.search(r'(?<![a-z_])_?acquiretimeouterror(?![a-z_])', message):
        matches.append(('local_queue_timeout', None))
    # Conflicting causes are not evidence for an automatic short cooldown.
    if len(matches) == 1:
        kind, window = matches[0]
        result.update(kind=kind, summary=SUMMARIES[kind])
        if window:
            result['window'] = window
    return result


def validate_backoff(value, now):
    """Reject malformed/future-dated state instead of dropping a cooldown."""
    def timestamp(number):
        return type(number) in (int, float) and math.isfinite(number) and number > 0
    if (not isinstance(value, dict) or type(value.get('schema')) is not int or value['schema'] != 1
            or not isinstance(value.get('kind'), str) or value['kind'] not in TRANSIENT_KINDS
            or type(value.get('attempt')) is not int or not 1 <= value['attempt'] <= 7
            or not timestamp(now) or not timestamp(value.get('failedAt'))
            or not timestamp(value.get('nextAttemptAt')) or value['failedAt'] > now
            or value['nextAttemptAt'] != value['failedAt'] + min(3600, 60 * 2 ** (value['attempt'] - 1))
            or any(not isinstance(value.get(key), str)
                   or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value[key]) for key in ('taskId', 'turnId'))):
        raise ValueError('inference_backoff_invalid')
    return value


def next_backoff(kind, previous, now, task_id, turn_id):
    attempt = min(7, validate_backoff(previous, now)['attempt'] + 1) if previous is not None else 1
    return validate_backoff({'schema': 1, 'kind': kind, 'attempt': attempt,
                             'failedAt': now, 'nextAttemptAt': now + min(3600, 60 * 2 ** (attempt - 1)),
                             'taskId': task_id, 'turnId': turn_id}, now)


def public_inference_state(failure, backoff, now):
    """Project fixed descriptions and bounded metadata, never the error body."""
    public_failure = None
    if isinstance(failure, dict):
        kind = failure.get('kind')
        kind = kind if isinstance(kind, str) and kind in SUMMARIES else 'unknown'
        public_failure = {'kind': kind, 'summary': SUMMARIES[kind]}
        for key in ('code', 'taskId', 'turnId'):
            value = failure.get(key)
            if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', value):
                public_failure[key] = value
        observed = failure.get('observedAt')
        if type(observed) is int and 0 < observed < 10**16:
            public_failure['observedAt'] = observed
        if failure.get('window') in ('hour', 'week', 'month'):
            public_failure['window'] = failure['window']
    public_backoff = None
    if backoff is not None:
        try:
            valid = validate_backoff(backoff, now)
            public_backoff = {key: valid[key] for key in
                ('schema', 'kind', 'attempt', 'failedAt', 'nextAttemptAt', 'taskId', 'turnId')}
        except ValueError:
            public_backoff = {'valid': False, 'code': 'inference_backoff_invalid'}
    return public_failure, public_backoff
