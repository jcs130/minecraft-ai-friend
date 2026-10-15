"""Iron's Spells 3.16.3, Java Client Bridge minescript.run sample.

Use after normal inscription, Curios equipment, spell selection and aiming.
Requires control lease and a working Minescript Python interpreter. This presses
the mod's ordinary cast key; the server still checks mana and cooldown. Execute
once, inspect the action receipt and world afterwards; do not retry an unknown.
"""
import time
import minescript as m

# Server MagicData.getPlayerMagicData(localPlayer) is not the client's synced
# resource view. Calling it here can misleadingly return zero mana.
magic = m.java_class('io.redspace.ironsspellbooks.player.ClientMagicData')
get_mana = m.java_member(magic, 'getPlayerMana')
before = int(m.java_to_string(m.java_call_method(magic, get_mana)))
keys = m.java_class('io.redspace.ironsspellbooks.player.KeyMappings')
key = m.java_access_field(keys, m.java_member(keys, 'SPELLBOOK_CAST_ACTIVE_KEYMAP'))
set_down = m.java_member(m.java_class('io.redspace.ironsspellbooks.player.ExtendedKeyMapping'), 'setDown')
try:
    # Minescript 4.0's cached press_key_bind list may predate this late mod key.
    m.java_call_method(key, set_down, m.java_bool(True))
    time.sleep(0.15)
finally:
    m.java_call_method(key, set_down, m.java_bool(False))
time.sleep(0.2)
after = int(m.java_to_string(m.java_call_method(magic, get_mana)))
result = {'manaBefore': before, 'manaAfter': after, 'keyReleased': True,
          'source': 'native_client_synced_ClientMagicData', 'goalCompleted': False}
# Script completion only confirms input delivery. Verify the actual target,
# inventory/resource changes and server state separately before claiming a hit.
