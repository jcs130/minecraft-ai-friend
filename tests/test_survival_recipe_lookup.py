"""Native recipe reuse: no live server, model, lease write or crafting."""
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'world/survival'))
from numen_gateway import NumenGateway, write_json
from recipe_lookup import MAX_REPLY_BYTES, MAX_TEXT_BYTES, lookup_recipe

BODY_UUID = 'd4ac9523-4962-43ed-98c5-19b49e104048'
ONLINE = 'count=1\nKirito|uuid='+BODY_UUID+'|owner=fixture|dim=minecraft:overworld|pos=-543,69,840\n'
RECIPE = ('recipe(s) for arcane_ingot:\n\n[crafting] shaped 3x3, makes 1:\n'
          '  arcane_essence | arcane_essence | arcane_essence\n'
          '  arcane_essence | ingot(any) | arcane_essence\n'
          '  arcane_essence | arcane_essence | arcane_essence\n\nTo make it —\n'
          '• [crafting]: call craft {item_id, count}\n• interact_at the furnace')


class Rcon:
    def __init__(self):
        self.calls = []
        self.roster = ONLINE
        self.reply = json.dumps({'success': True, 'message': RECIPE})

    def cmd(self, command):
        self.calls.append(command)
        if command == 'numen_act list': return self.roster
        if not command.startswith('numen_act invoke "Kirito" lookup_recipe '):
            raise AssertionError('non-query command')
        if isinstance(self.reply, Exception): raise self.reply
        return self.reply


class RecipeLookupTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.state = Path(temporary.name)
        self.rcon = Rcon()
        self.gateway = NumenGateway(self.state, self.rcon, clock=lambda:1800000000)
        self.settings = {'bodyName':'Kirito', 'bodyUuid':BODY_UUID}
        write_json(self.state/'settings.json', self.settings)

    def test_current_native_modded_recipe_and_source_are_retained_without_old_actions(self):
        result = lookup_recipe(self.gateway, 'irons_spellbooks:arcane_ingot')
        self.assertTrue(result['ok']); self.assertTrue(result['found'])
        self.assertEqual(result['itemId'], 'irons_spellbooks:arcane_ingot')
        self.assertEqual(result['bodyUuid'], BODY_UUID)
        self.assertEqual(result['observedAt'], 1800000000000)
        self.assertIn('[crafting] shaped 3x3', result['recipeText'])
        self.assertIn('makes 1', result['recipeText'])
        self.assertIn('未展开候选组（词缀：ingot；真实成员未知）', result['recipeText'])
        self.assertNotIn('ingot(any)', result['recipeText'])
        self.assertEqual(result['recipeText'].count('arcane_essence'), 8)
        self.assertFalse(result['ingredientsResolved'])
        self.assertEqual(result['materialAvailability'], 'not_checked')
        self.assertIn('不能从词缀推出任何具体锭可以替代', result['notice'])
        self.assertNotIn('interact_at', result['recipeText'])
        self.assertFalse(result['coverage']['complete'])
        self.assertEqual(result['coverage']['nativeRecipeLimit'], 4)
        self.assertIn('命名空间', result['notice'])
        self.assertEqual(self.rcon.calls, ['numen_act list',
            'numen_act invoke "Kirito" lookup_recipe {"item_id": "irons_spellbooks:arcane_ingot"}'])

    def test_invalid_namespaced_ids_are_rejected_before_io(self):
        for item in ('iron_ingot', '#minecraft:planks', 'minecraft:IRON', 'minecraft:iron\ningot',
                     'minecraft:iron"} execute', '', 'minecraft:'+'a'*128, None, 42, {'actor':'elsewhere'}):
            with self.subTest(item=item):
                self.assertEqual(lookup_recipe(self.gateway, item)['code'], 'invalid_item_id')
        self.assertFalse(self.rcon.calls)

    def test_lossy_material_groups_do_not_invent_complete_members_or_namespace(self):
        self.rcon.reply = json.dumps({'success':True, 'message':
            'recipe(s) for example:\n\n[crafting] shapeless, makes 2: '
            '1x planks(any), 1x any[iron_ingot/gold_ingot/…], 1x arcane_essence'})
        result = lookup_recipe(self.gateway, 'example:item')
        self.assertNotIn('(any)', result['recipeText'])
        self.assertNotIn('any[', result['recipeText'])
        self.assertIn('未展开候选组（词缀：planks；真实成员未知）', result['recipeText'])
        self.assertIn('原生简称片段：iron_ingot/gold_ingot/…；完整成员未确认', result['recipeText'])
        self.assertIn('[crafting] shapeless, makes 2', result['recipeText'])
        self.assertIn('1x arcane_essence', result['recipeText'])
        self.assertNotIn('minecraft:iron_ingot', result['recipeText'])
        self.assertFalse(result['ingredientsResolved'])
        self.assertEqual(result['materialAvailability'], 'not_checked')

    def test_query_does_not_create_or_update_any_state_file_even_while_paused_and_unknown(self):
        for name, data in {'control.json': {'enabled':False},
                           'lease.json': {'status':'unknown'},
                           'unknown.json': {'tool':'mine'},
                           'controller.json': {'decisions':[{'startedAt':1}]*48}}.items():
            write_json(self.state/name, data)
        before = {path.name:path.read_bytes() for path in self.state.iterdir()}
        with patch.object(self.gateway, 'action', side_effect=AssertionError('action called')):
            self.assertTrue(lookup_recipe(self.gateway, 'minecraft:crafting_table')['ok'])
        self.assertEqual(before, {path.name:path.read_bytes() for path in self.state.iterdir()})

    def test_offline_and_wrong_uuid_block_native_query(self):
        for roster in ('count=0', ONLINE.replace(BODY_UUID, 'e5005711-be9f-44b7-aaad-6993c0ba5df4')):
            self.rcon.roster = roster; self.rcon.calls.clear()
            self.assertFalse(lookup_recipe(self.gateway, 'minecraft:stick')['ok'])
            self.assertEqual(self.rcon.calls, ['numen_act list'])
        self.settings.pop('bodyUuid'); write_json(self.state/'settings.json', self.settings)
        self.rcon.calls.clear()
        self.assertEqual(lookup_recipe(self.gateway, 'minecraft:stick')['code'], 'body_binding_invalid')
        self.assertFalse(self.rcon.calls)

    def test_binding_change_between_configuration_and_roster_cannot_redirect(self):
        with patch.object(self.gateway, '_check_binding', return_value=('Other', BODY_UUID)):
            self.assertEqual(lookup_recipe(self.gateway, 'minecraft:stick')['code'], 'body_binding_invalid')
        self.assertFalse(self.rcon.calls)

    def test_no_recipe_does_not_claim_mined_or_traded_only(self):
        self.rcon.reply = json.dumps({'success':True, 'message':
            "no recipe for special_gem — it's obtained another way (mine it, or trade), not crafted or smelted."})
        result = lookup_recipe(self.gateway, 'example:special_gem')
        self.assertEqual(result['code'], 'no_supported_recipe')
        self.assertFalse(result['found'])
        self.assertNotIn('not crafted', result['recipeText'])
        self.assertIn('尚未确认', result['recipeText'])

    def test_unknown_native_text_is_not_interpreted_as_complete_recipe(self):
        self.rcon.reply = json.dumps({'success':True, 'message':'Changed query output format'})
        result = lookup_recipe(self.gateway, 'minecraft:stick')
        self.assertIsNone(result['found'])
        self.assertFalse(result['coverage']['complete'])

    def test_large_multibyte_text_is_bounded_and_marked_truncated(self):
        self.rcon.reply = json.dumps({'success':True, 'message':'recipe(s) for stick:\n'+'材料'*4000}, ensure_ascii=False)
        result = lookup_recipe(self.gateway, 'minecraft:stick')
        self.assertTrue(result['truncated'])
        self.assertLessEqual(len(result['recipeText'].encode('utf8')), MAX_TEXT_BYTES)
        self.assertLess(len(json.dumps(result,ensure_ascii=False).encode('utf8')), 8192)

    def test_oversized_malformed_or_async_reply_is_not_a_recipe_receipt(self):
        for value in ('x'*(MAX_REPLY_BYTES+1), '[1]', '{}', '{"accepted":true}',
                      '{"success":1,"message":"fake"}', '{"success":true,"message":[]}', 'not json',
                      json.dumps({'success':True,'message':'\ud800'})):
            self.rcon.reply = value
            self.assertEqual(lookup_recipe(self.gateway, 'minecraft:stick')['code'], 'native_recipe_reply_invalid')

    def test_native_failure_and_transport_loss_do_not_retry_or_echo_exception(self):
        for value, code in ((json.dumps({'success':False,'message':'unavailable'}),'native_recipe_lookup_failed'),
                            (TimeoutError('private transport details'),'recipe_lookup_unavailable')):
            self.rcon.reply = value; self.rcon.calls.clear()
            result = lookup_recipe(self.gateway, 'minecraft:stick')
            self.assertEqual(result['code'], code)
            self.assertEqual(len(self.rcon.calls), 2)
            self.assertNotIn('private', json.dumps(result))

    @unittest.skipUnless(importlib.util.find_spec('mcp'), 'Native MCP SDK is tested in the survivor image')
    def test_native_mcp_schema_and_call_are_read_only_and_bound(self):
        import mcp_server
        async def check():
            server = mcp_server.make_server(self.gateway)
            listed = await server.list_tools()
            tool = next(tool for tool in listed if tool.name == 'lookup_recipe')
            self.assertEqual(set(tool.inputSchema['properties']), {'item_id'})
            self.assertEqual(tool.inputSchema['required'], ['item_id'])
            self.assertIn('lookup_recipe', mcp_server.TOOL_NAMES)
            result = await server.call_tool('lookup_recipe', {'item_id':'irons_spellbooks:arcane_ingot'})
            text = result[0][0].text if isinstance(result, tuple) else result[0].text
            self.assertTrue(json.loads(text)['readOnly'])
        asyncio.run(check())
        self.assertEqual(len(self.rcon.calls), 2)


if __name__ == '__main__': unittest.main()
