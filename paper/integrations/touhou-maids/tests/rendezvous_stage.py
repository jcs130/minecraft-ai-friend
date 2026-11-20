"""Compare native owner-follow and an explicitly chosen visitor on a synthetic server.

Run native-body-stage.py --fixture FIXTURE --rendezvous-players PLAYERS --output REPORT
with the NativeBodyProbe/RecruitmentProbe test mods, all three synthetic players
connected, Vortex enabled and the original owned resident registered in both bridges.
PLAYERS maps MaidOwnerQA, MaidSocialOne and MaidSocialTwo to their offline-mode UUIDs.
The caller verifies both test-only markers and the loopback bind before any setup.
"""
import json
import math
import time
import uuid


def verify(fixture, players, client, command, check):
    owner, maid = fixture["ownerId"], fixture["maidId"]
    assert owner == players["MaidOwnerQA"]
    target = players["MaidSocialOne"]
    other = players["MaidSocialTwo"]
    assert len({owner, target, other, maid}) == 4
    assert all(name in command("list") for name in ("MaidOwnerQA","MaidSocialOne","MaidSocialTwo"))

    def in_world(world, text):
        return command(f"minecraft:execute in minecraft:{world} run {text}")

    def place(name, world, x, y=81, z=100.5):
        return in_world(world, f"minecraft:tp {name} {x} {y} {z}")

    def resident():
        text = command(f"maidagent resident {maid} status")
        return json.loads(text[text.index("{"):])

    def context():
        return client.call("context")["data"]

    def action(name, **fields):
        request = "visit-" + uuid.uuid4().hex
        return client.call(name, requestId=request, **fields)["data"]

    def walk_to(player, x, y, z):
        row = action("walk", dimension="minecraft:"+destination, targetUuid=player, x=x, y=y, z=z)
        deadline = time.monotonic()+32
        while not row["terminal"] and time.monotonic()<deadline:
            time.sleep(.2)
            row = client.call("receipt", operationId=row["requestId"])["data"]
        return row

    def sample(label, center):
        samples = []
        for _ in range(18):
            live = context()
            samples.append([live["dimension"],*live["position"]])
            time.sleep(1)
        check(label, all(p[0]=="minecraft:"+destination and math.dist(p[1:],center)<12 for p in samples), samples=samples)

    source = resident()["dimension"].removeprefix("minecraft:")
    assert source in ("overworld","the_nether")
    destination = "overworld" if source=="the_nether" else "the_nether"
    body = json.loads(in_world(source, f"companiontest body {maid}"))
    check("original_online_owner", body["owner"]==owner)
    for world in (source,destination):
        in_world(world,"minecraft:forceload add 160 80 288 128")
        in_world(world,"minecraft:fill 160 79 90 285 80 110 minecraft:stone")
        in_world(world,"minecraft:fill 160 81 90 285 86 110 minecraft:air")
    place("MaidOwnerQA",source,260.5)
    place("MaidSocialOne",destination,185.5)
    in_world(source,f"companiontest position {maid} 178.5 81 100.5")
    client.bind()
    try:
        if not context().get("socialWalkAvailable"):
            action("follow")
        for _ in range(30):
            if resident()["rpg"].get("mana",{}).get("current",0)>=8:
                break
            time.sleep(1)
        cast=action("rendezvous",targetUuid=target)
        check("visits_nonowner_across_worlds",cast["goalCompleted"] and cast["observation"]["targetUuid"]==target,receipt=cast)
        sample("owner_online_in_previous_world",(185.5,81,100.5))
        place("MaidOwnerQA",destination,260.5)
        sample("owner_arrives_in_same_world_without_taking_body",(185.5,81,100.5))
        place("MaidSocialOne",destination,171.5)
        walk=walk_to(target,172.5,81,100.5)
        check("follows_moving_visitor",walk["goalCompleted"] and context()["socialNavigationTargetUuid"]==target,receipt=walk)
        stale=action("release_rendezvous",targetUuid=other)
        check("stale_release_preserves_selection",not stale["observation"]["effectsApplied"] and context()["socialNavigationTargetUuid"]==target)
        released=action("release_rendezvous",targetUuid=target)
        check("release_restores_native_navigation",released["observation"]["selectionReleased"] and not context()["socialNavigationTargetUuid"])
        for _ in range(20):
            if abs(context()["position"][0]-260.5)<6:
                break
            time.sleep(1)
        check("original_owner_follow_resumes",abs(context()["position"][0]-260.5)<6)
        x,y,z=context()["position"]
        place("MaidSocialTwo",destination,x+1,y,z)
        walk=walk_to(other,x,y,z)
        check("nearby_selection_without_paid_cast",walk["goalCompleted"] and context()["socialNavigationTargetUuid"]==other,receipt=walk)
        place("MaidOwnerQA",destination,176.5)
        sample("nearby_selection_survives_owner_movement",(x,y,z))
        client.release()
        client.env.pop("generation")
        client.bind()
        check("lease_release_clears_selection",not context()["socialNavigationTargetUuid"])
    finally:
        client.release()
