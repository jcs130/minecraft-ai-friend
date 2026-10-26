"""Read language data in the lenient forms accepted by the game, without eval."""
import json

NORMALIZATIONS = []


def parse_language(data, source='unknown'):
    text = data.decode('utf-8-sig') if isinstance(data, bytes) else data
    mode = None
    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        try:
            result = json.loads(text, strict=False)
            mode = 'literal_control_characters'
        except json.JSONDecodeError:
            import json5
            result = json5.loads(text)
            mode = 'json5_comments_or_trailing_commas'
    if not isinstance(result, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in result.items()):
        raise ValueError('Language file must be a string-to-string object: ' + source)
    if mode: NORMALIZATIONS.append({'source': source, 'normalization': mode, 'contentRewritten': False})
    return result
