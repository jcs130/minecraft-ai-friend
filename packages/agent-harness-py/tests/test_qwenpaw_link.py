from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Event
from uuid import uuid4

import pytest

from agent_mc_harness.qwenpaw_link import Character, PawLinker


class PawFixture:
    def __init__(self):
        self.agents = {}
        self.posts = []
        self.mode = "normal"
        self.dispatch_entered = Event()
        self.release = Event()

    def __call__(self, method, path, body):
        if method == "GET" and path == "/api/agents":
            return 200, {"agents": list(self.agents.values())}
        if method == "GET":
            found = self.agents.get(path.rsplit("/", 1)[1])
            return (200, found) if found else (404, None)
        assert (method, path) == ("POST", "/api/agents")
        assert set(body) == {"id", "name", "backend", "skill_names", "language", "workspace_dir"}
        assert body["skill_names"] == []
        self.posts.append(body)
        if self.mode == "blocked":
            self.dispatch_entered.set()
            assert self.release.wait(5)
        if self.mode == "lost_before_commit":
            raise TimeoutError
        self.agents[body["id"]] = dict(body)
        if self.mode == "lost_after_commit":
            raise TimeoutError
        return 201, self.agents[body["id"]]


@pytest.fixture
def character():
    return Character("qa-realm", uuid4(), uuid4(), uuid4(), "maid", "合成伙伴")


def linker(root, api):
    return PawLinker(root / "links.sqlite3", root, "dedicated-lab", api)


def test_same_role_survives_restart_and_rename(tmp_path, character):
    api = PawFixture()
    first = linker(tmp_path, api).ensure(character)
    again = linker(tmp_path, api).ensure(replace(character, name="新名字"))
    assert first == again and first.state == "linked" and len(api.posts) == 1
    elsewhere = linker(tmp_path, api).ensure(replace(character, realm="another-realm"))
    assert elsewhere.state == "linked" and elsewhere.agent_id != first.agent_id
    assert all(x not in str(api.posts) for x in (str(character.owner_id), str(character.body_id), str(character.character_id)))


def test_lost_create_reply_checks_only_original(tmp_path, character):
    api = PawFixture()
    api.mode = "lost_after_commit"
    assert linker(tmp_path, api).ensure(character).state == "linked"
    assert linker(tmp_path, api).ensure(character).state == "linked"
    assert len(api.posts) == 1


def test_uncertain_absence_never_reposts(tmp_path, character):
    api = PawFixture()
    api.mode = "lost_before_commit"
    assert linker(tmp_path, api).ensure(character).state == "pending"
    api.mode = "normal"
    assert linker(tmp_path, api).ensure(character).state == "pending"
    assert len(api.posts) == 1


@pytest.mark.parametrize("alias", [False, True])
def test_preexisting_id_is_not_an_ownership_proof(tmp_path, character, alias):
    api = PawFixture()
    agent_id = character.agent_id.upper() if alias else character.agent_id
    api.agents[agent_id] = {"id": agent_id, "name": character.name, "workspace_dir": str(tmp_path / "someone-else")}
    assert linker(tmp_path, api).ensure(character).state == "conflict"
    assert not api.posts


def test_bound_owner_change_and_missing_remote_ref_do_not_recreate(tmp_path, character):
    api = PawFixture()
    assert linker(tmp_path, api).ensure(character).state == "linked"
    assert linker(tmp_path, api).ensure(replace(character, owner_id=uuid4())).state == "conflict"
    api.agents[character.agent_id]["workspace_dir"] = str(tmp_path / "different-workspace")
    assert linker(tmp_path, api).ensure(character).state == "drift"
    api.agents.clear()
    assert linker(tmp_path, api).ensure(character).state == "drift"
    assert len(api.posts) == 1
    with pytest.raises(ValueError, match="instance_identity_changed"):
        PawLinker(tmp_path / "links.sqlite3", tmp_path, "another-instance", api)


def test_concurrent_discovery_reserves_only_one_post(tmp_path, character):
    api = PawFixture()
    api.mode = "blocked"
    first, second = linker(tmp_path, api), linker(tmp_path, api)
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(first.ensure, character)
        try:
            assert api.dispatch_entered.wait(3)
            assert second.ensure(character).state == "pending"
        finally:
            api.release.set()
        assert pending.result(timeout=3).state == "linked"
    assert len(api.posts) == 1


def test_numen_is_not_eligible_for_the_prototype(character):
    with pytest.raises(ValueError, match="unsupported_qwenpaw_body"):
        replace(character, kind="numen")
