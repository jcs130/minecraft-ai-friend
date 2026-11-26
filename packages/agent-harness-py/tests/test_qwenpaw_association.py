import asyncio
from uuid import uuid4

import pytest

from agent_mc_harness.qwenpaw_association import PawAssociations
from test_qwenpaw_link import PawFixture
from test_server_npc import role as configured_role


def role(**changes):
    return configured_role(**({"body_kind":"maid"} | changes))


def settings(root, actor):
    return {"enabled":True,"dedicatedInstance":True,"endpoint":"http://127.0.0.1:59999",
            "instanceKey":"synthetic-test", "workspaceRoot":str(root),"stateFile":str(root / "links.sqlite"),
            "allowedCharacters":[str(actor.character_id)]}


def test_default_does_not_create_or_contact_paw(tmp_path):
    async def run():
        api=PawFixture(); actor=role()
        wrapper=PawAssociations(None,"synthetic",request=api)
        assert await wrapper.admit(actor) is None and not api.posts
        assert wrapper.summary()=={"enabled":False,"characters":{}}
        await wrapper.close()
    asyncio.run(run())


def test_confirmed_allowed_character_creates_once_without_body_tools(tmp_path):
    async def run():
        actor=role();api=PawFixture();cfg=settings(tmp_path,actor)
        wrapper=PawAssociations(cfg,"synthetic",request=api)
        first=await wrapper.admit(actor); second=await wrapper.admit(actor)
        assert first.state==second.state=="linked" and len(api.posts)==1
        assert await wrapper.admit(role(character_id=uuid4())) is None
        assert await wrapper.admit(role(body_kind="numen",character_id=actor.character_id)) is None
        assert len(api.posts)==1 and str(actor.body_id) not in str(api.posts)
        await wrapper.close()
    asyncio.run(run())


def test_uncertain_remote_does_not_retry_after_reopen(tmp_path):
    async def run():
        actor=role();api=PawFixture();api.mode="lost_before_commit";cfg=settings(tmp_path,actor)
        wrapper=PawAssociations(cfg,"synthetic",request=api)
        assert (await wrapper.admit(actor)).state=="pending"
        await wrapper.close();api.mode="normal"
        again=PawAssociations(cfg,"synthetic",request=api)
        assert (await again.admit(actor)).state=="pending" and len(api.posts)==1
        await again.close()
    asyncio.run(run())


@pytest.mark.parametrize("change", [{"dedicatedInstance":False}, {"endpoint":"https://example.com"},
    {"endpoint":"http://127.0.0.1:80/other"}, {"allowedCharacters":[]},
    {"allowedCharacters":["not-a-uuid"]}, {"workspaceRoot":"relative"}])
def test_invalid_configuration_cannot_contact_remote(tmp_path,change):
    actor=role();api=PawFixture()
    with pytest.raises((ValueError,KeyError)):
        PawAssociations(settings(tmp_path,actor)|change,"synthetic",request=api)
    assert not api.posts
