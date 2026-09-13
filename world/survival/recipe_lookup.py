"""Read current-server recipes through Numen's existing query, never craft.

The native query reads RecipeManager. It supports standard crafting/cooking,
stonecutting and smithing classes, including mods that use those classes. Its
human-readable ingredients are not a complete namespaced material contract.
"""
import json
import re
import uuid

from numen_gateway import IDENTIFIER

MAX_REPLY_BYTES = 32768
MAX_TEXT_BYTES = 6144
SOURCE = 'numen.lookup_recipe/current_server_recipe_manager'
NOTICE = ('当前服务器配方查询，原生最多展示4条，顺序不保证最合适。'
          '未覆盖自定义机器、动态或特殊配方；未发现不能断言物品不可制作。'
          '候选组是按词缀压缩的未展开信息，不是任意同类材料皆可；不能从词缀推出任何具体锭可以替代。'
          '单个材料名也仅是简称，可能省略命名空间；不能据此猜测完整物品ID。材料可用性和背包数量未检查。'
          '这里只提供参考；craft仅执行工作台类配方，仍需真实材料与可用工作台。')


def lookup_recipe(gateway, item_id):
    """One fixed-body, read-only native lookup; no state writes or retry loop."""
    base = {'schema': 1, 'readOnly': True, 'source': SOURCE,
            'ingredientsResolved': False, 'materialAvailability': 'not_checked'}
    if (not isinstance(item_id, str) or not 1 <= len(item_id) <= 128
            or not IDENTIFIER.fullmatch(item_id)):
        return {**base, 'ok': False, 'code': 'invalid_item_id'}
    base['itemId'] = item_id
    try:
        settings = gateway._settings()
        expected = settings.get('bodyUuid')
        if not isinstance(expected, str) or str(uuid.UUID(expected)) != expected:
            return {**base, 'ok': False, 'code': 'body_binding_invalid'}
        name, actual_uuid = gateway._check_binding()
        if name != settings['bodyName'] or actual_uuid != expected:
            return {**base, 'ok': False, 'code': 'body_binding_invalid'}
        # Capture the checked actor, rather than re-read settings in _invoke.
        # Both command name and argument keys are fixed, with no raw-command API.
        command = ('numen_act invoke ' + json.dumps(name) + ' lookup_recipe '
                   + json.dumps({'item_id': item_id}, ensure_ascii=True))
        raw = gateway.rcon.cmd(command)
    except (OSError, ValueError, TypeError, KeyError):
        return {**base, 'ok': False, 'code': 'recipe_lookup_unavailable'}
    base.update(bodyName=name, bodyUuid=actual_uuid, observedAt=gateway._now())
    try:
        if not isinstance(raw, str) or len(raw.encode('utf8')) > MAX_REPLY_BYTES:
            return {**base, 'ok': False, 'code': 'native_recipe_reply_invalid'}
        result = json.loads(raw)
    except ValueError:
        return {**base, 'ok': False, 'code': 'native_recipe_reply_invalid'}
    if (not isinstance(result, dict) or type(result.get('success')) is not bool
            or not isinstance(result.get('message'), str)):
        return {**base, 'ok': False, 'code': 'native_recipe_reply_invalid'}
    if result['success'] is not True:
        return {**base, 'ok': False, 'code': 'native_recipe_lookup_failed'}
    message = result['message']
    found = False if message.startswith('no recipe for ') else (
        True if message.startswith('recipe(s) for ') else None)
    if found is False:
        # Native wording overclaims that missing recipes mean mined/traded only.
        text = '在原生查询支持的配方类型内未发现该物品配方；其他制作方式尚未确认。'
    else:
        # Drop old raw-tool execution advice; current MCP permissions remain the
        # only action interface. Recipe text itself stays quoted source data.
        text = message.split('\n\nTo make it —\n', 1)[0]
        # Native commonSuffixToken is a lossy label, not a tag or membership
        # test. Do not expose "ingot(any)" as if any ingot were acceptable.
        text = re.sub(r'\b([a-z0-9_./-]+)\(any\)',
                      r'未展开候选组（词缀：\1；真实成员未知）', text)
        text = re.sub(r'\bany\[([^\]\r\n]*)\]',
                      r'未展开候选组（原生简称片段：\1；完整成员未确认）', text)
    try:
        encoded = text.encode('utf8')
    except UnicodeError:
        return {**base, 'ok': False, 'code': 'native_recipe_reply_invalid'}
    text = encoded[:MAX_TEXT_BYTES].decode('utf8', errors='ignore')
    return {**base, 'ok': True,
            'code': 'recipes_found' if found is True else 'no_supported_recipe' if found is False else 'recipe_text',
            'found': found, 'recipeText': text, 'truncated': len(encoded) > MAX_TEXT_BYTES,
            'coverage': {'complete': False, 'nativeRecipeLimit': 4,
                         'types': ['crafting', 'smelting', 'blasting', 'smoking', 'campfire', 'stonecutting', 'smithing']},
            'notice': NOTICE}
