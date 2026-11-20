"""Turn unused, operator-prepared game bodies into independently owned resident characters."""
from __future__ import annotations

import asyncio
from pathlib import Path
import sqlite3
from uuid import UUID

import httpx

from .npc import NpcRole
from .resident_numen import validate_admission


def slot_templates(config, roles):
    body_ids = {body for role in roles for body in (role.body_id, *role.social_previous_bodies)}
    ids = {role.id for role in roles}
    slots = {}
    for slot_id, row in config.get("residentCreationSlots", {}).items():
        defaults = row["roleDefaults"]
        if set(defaults) & {"id", "character_id", "body_kind", "body_id", "owner_id", "name", "social_previous_bodies"}:
            raise ValueError("resident_slot_identity_must_be_independent")
        # The template is validated before the first reservation and is never attached.
        template = NpcRole(**defaults, id=slot_id, name=slot_id[:24], character_id=UUID(int=0),
                           body_id=row["bodyId"], owner_id=row["ownerGameId"], body_kind=row["bodyKind"])
        if slot_id in ids or template.body_id in body_ids:
            raise ValueError("resident_slot_already_assigned")
        if not config.get("bodies", {}).get(slot_id) or not config.get("residentTurns", {}).get(slot_id):
            raise ValueError("resident_slot_transport_missing")
        if "numenAdmission" in row:
            validate_admission(row, config["bodies"][slot_id])
        ids.add(slot_id)
        body_ids.add(template.body_id)
        slots[slot_id] = template
    return slots


class BirthRegistry:
    def __init__(self, state: Path, templates, roles):
        self.state = state
        self.db = sqlite3.connect(state / "resident-births.sqlite3")
        self.db.row_factory = sqlite3.Row
        self.db.execute("""CREATE TABLE IF NOT EXISTS births (
            slot TEXT PRIMARY KEY, body TEXT UNIQUE NOT NULL, owner TEXT NOT NULL, kind TEXT NOT NULL,
            character TEXT UNIQUE NOT NULL, name TEXT NOT NULL, persona TEXT NOT NULL)""")
        registered = {str(body) for role in roles for body in (role.body_id, *role.social_previous_bodies)}
        characters = {str(role.character_id) for role in roles}
        self.existing_characters = characters
        ids = {r.id for r in roles}
        for row in self.db.execute("SELECT * FROM births"):
            t = templates.get(row["slot"])
            if (row["body"] in registered or row["character"] in characters or row["slot"] in ids
                    or t and (row["body"], row["owner"], row["kind"]) != (str(t.body_id), str(t.owner_id), t.body_kind)
                    or any(str(other.body_id) == row["body"] and other.id != row["slot"] for other in templates.values())):
                raise ValueError("resident_birth_binding_changed")

    @staticmethod
    def role(template, row):
        data = template.model_dump()
        data.update(character_id=row["character"], name=row["name"], persona=row["persona"] or template.persona)
        return NpcRole.model_validate(data)

    def restore(self, template):
        row = self.db.execute("SELECT * FROM births WHERE slot=?", (template.id,)).fetchone()
        return self.role(template, row) if row else None

    def bind(self, template, profile):
        row = {"character": str(UUID(profile["characterId"])), "name": profile["name"], "persona": profile["persona"]}
        if row["character"] in self.existing_characters:
            raise ValueError("resident_character_already_assigned")
        role = self.role(template, row)
        if self.restore(template) is not None:
            raise ValueError("resident_slot_already_assigned")
        if (self.state / template.id).exists():
            raise ValueError("resident_slot_has_prior_state")
        with self.db:
            self.db.execute("INSERT INTO births VALUES(?,?,?,?,?,?,?)", (role.id, str(role.body_id), str(role.owner_id),
                            role.body_kind, row["character"], row["name"], row["persona"]))
        return role


async def binding_is_live(role, body):
    identity = body.identity()
    if (not identity or identity.kind != role.body_kind or identity.body_id != str(role.body_id)
            or identity.owner_id != str(role.owner_id) or identity.scope.character != str(role.character_id)
            or not body.health().connected):
        return False
    scene = await body.snapshot()
    return scene.life_state == "alive" and body.identity() == identity and body.health().connected


async def activate(template, registry, client, attach, current_body, *, interval=5):
    role = registry.restore(template)
    attached = False
    while True:
        try:
            if role is None:
                profile = await client.activation()
                if profile:
                    role = registry.bind(template, profile)
            if role and not attached:
                attach(role)
                attached = True
            if role and await binding_is_live(role, current_body(role.id)):
                profile = await client.activation(ready=str(role.character_id))
                if profile and profile["characterId"] == str(role.character_id):
                    return
                raise ValueError("resident_activation_changed")
        except (httpx.HTTPError, TimeoutError, ConnectionError, RuntimeError):
            pass  # A game server or portal restart must leave the durable reservation intact.
        await asyncio.sleep(interval)
