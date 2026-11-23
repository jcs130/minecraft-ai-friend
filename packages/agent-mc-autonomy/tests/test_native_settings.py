import pytest

from agent_mc_autonomy.configuration import Settings


def config(native=None):
    return {'server': {'host': 'fixture.test', 'username': 'Alice'}, **({'native': native} if native is not None else {})}


def test_omitted_native_options_preserve_core_defaults(tmp_path):
    world = Settings.parse(config()).client_config(tmp_path)['world']
    assert all(key not in world for key in ('combat', 'reflex', 'scaffoldBlocks', 'idle', 'journey', 'show'))

@pytest.mark.parametrize("voice", [None, {}, {"enabled": False}, {"enabled": True}])
def test_proximity_voice_requires_opt_in_and_projects_only_server_game_audio(tmp_path, voice):
    native = {} if voice is None else {"proximity_voice": voice}
    settings = Settings.parse(config(native))
    world = settings.client_config(tmp_path)["world"]
    enabled = voice == {"enabled": True}
    assert settings.proximity_voice_enabled is enabled
    assert settings.native.public_config() == native
    assert settings.identity == Settings.parse(config()).identity
    if enabled:
        assert world["proximityVoice"] == {"enabled": True, "speechSource": "server", "outputMode": "game-only"}
        assert "proximityVoice" not in settings.native.client_config(mineflayer=False)
    else:
        assert "proximityVoice" not in world

def test_explicit_native_options_are_forwarded_without_aliasing(tmp_path):
    raw = {'combat': {'enabled': False, 'engageRadius': 4}, 'reflex': {'fleeHealth': 8},
           'scaffold_blocks': ['dirt'], 'idle': {'enabled': True, 'allowMovement': False},
           'journey': {'enabled': False}, 'show': {'clickMs': 100}}
    settings = Settings.parse(config(raw))
    world = settings.client_config(tmp_path)['world']
    assert world['combat'] == raw['combat'] and world['reflex'] == raw['reflex']
    assert world['scaffoldBlocks'] == ['dirt'] and world['idle'] == raw['idle']
    world['combat']['enabled'] = True
    assert settings.client_config(tmp_path)['world']['combat']['enabled'] is False


def test_perception_defaults_and_explicit_awareness_do_not_enable_mineral_vision(tmp_path):
    assert Settings.parse(config()).client_config(tmp_path)['world']['perception'] == {'mineralVision': False}
    raw = {'perception': {'entityView': 'surroundings', 'entityRange': 64, 'nearbyOccludedRange': 0}}
    settings = Settings.parse(config(raw))
    world = settings.client_config(tmp_path)['world']
    assert world['perception'] == {'mineralVision': False, **raw['perception']}
    world['perception']['nearbyOccludedRange'] = 16
    assert settings.client_config(tmp_path)['world']['perception']['nearbyOccludedRange'] == 0


@pytest.mark.parametrize('native', [
    {'combat': {'enabled': 1}}, {'reflex': {'fleeHealth': -1}}, {'combat': {'engageRadius': 99}},
    {'scaffold_blocks': ['']}, {'scaffold_blocks': 'dirt'}, {'scaffold_blocks': ['stone'] * 40},
    {'local': {'cheats': True}}, {'precheck': False}, {'unknown': {}},
    {'journey': {'choiceMinBlocks': 30, 'choiceMaxBlocks': 10}}, {'idle': {'minIdleMs': True}},
    {'show': {'budgetMs': 999999}}, {'combat': {'maxSec': float('nan')}},
    {'perception': {'entityRange': 64.5}}, {'perception': {'entityRange': True}},
    {'perception': {'nearbyOccludedRange': 17}}, {'perception': {'nearbyOccludedRange': -1}},
    {'perception': {'entityView': 'omniscient'}}, {'perception': {'mineralVision': True}},
    {'proximity_voice': {'enabled': 'true'}}, {'proximity_voice': {'enabled': 1}},
    {'proximity_voice': {'enabled': True, 'outputMode': 'live-and-game'}},
    {'proximity_voice': {'enabled': True, 'audioProducerUrl': 'http://fixture.test'}},
])
def test_native_options_reject_unsupported_or_invalid_values(native):
    with pytest.raises(ValueError):
        Settings.parse(config(native))
