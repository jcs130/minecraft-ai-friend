"""Compare native-rewritten JSON without overlooking fields, types or duplicate keys."""
import json
from pathlib import Path
import sys


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON field; configuration comparison is ambiguous')
        result[key] = value
    return result


def canonical(text):
    value = json.loads(text.removeprefix('\ufeff'), object_pairs_hook=unique_object,
                       parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-JSON number')))
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False)


def verify(expected, actual):
    if canonical(Path(expected).read_text(encoding='utf-8-sig')) != canonical(Path(actual).read_text(encoding='utf-8-sig')):
        raise ValueError('Native JSON contents changed; values are not printed')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: verify_native_json.py EXPECTED_JSON ACTUAL_JSON')
    verify(*sys.argv[1:])
    print(json.dumps({'equal': True, 'comparison': 'complete_typed_json', 'valuesRedacted': True}))
