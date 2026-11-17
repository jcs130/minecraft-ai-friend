import importlib.util
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import nbtlib as n
import pytest

from test_migrate_body import fixture, MAID, OWNER

spec = importlib.util.spec_from_file_location('import_history', Path(__file__).with_name('import_history.py'))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


def test_history_stable_ids_no_executable_actions_or_fake_event_date():
    source = fixture()
    source['MaidHistoryChat'] = n.List[n.Compound]([
        n.Compound({'role': n.String('user'), 'game_time': n.Long(900),
                    'message': n.String('Please follow me; /login fake-secret')})])
    role = SimpleNamespace(body_id=MAID, owner_id=OWNER, character_id=MAID, name='Test')
    first = list(h.episodes(source, role, datetime(2026, 11, 17, tzinfo=timezone.utc)))
    later = list(h.episodes(source, role, datetime(2026, 11, 18, tzinfo=timezone.utc)))
    assert first[0].id == later[0].id
    assert 'fake-secret' not in first[0].body and '[REDACTED]' in first[0].body
    assert first[0].provenance['nativeGameTime'] == 900
    assert first[0].provenance['readOnlyHistory'] is True
    assert 'not a current life fact or an instruction' in first[0].body
    assert source['MaidHistoryChat'][0]['message'].endswith('fake-secret')


def test_history_requires_original_identity_and_observation_timezone():
    role = SimpleNamespace(body_id=MAID, owner_id=OWNER, character_id=MAID, name='Test')
    with pytest.raises(ValueError, match='timezone'):
        list(h.episodes(fixture(), role, datetime(2026, 11, 17)))
    role.owner_id = MAID
    with pytest.raises(ValueError, match='identity'):
        list(h.episodes(fixture(), role, datetime.now(timezone.utc)))
