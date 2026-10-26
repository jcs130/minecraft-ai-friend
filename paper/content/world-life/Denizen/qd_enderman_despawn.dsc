# Paper 1.21.1 treats carried blocks as custom persistence. Restore vanilla
# despawning for old natural holders when their chunks load, without polling
# all entities or loading chunks. WorldGuard enderman-grief prevents new ones.
qd_enderman_despawn:
  type: world
  debug: false
  events:
    on server start:
    # Spawn chunks can load before Denizen registers entity-add events.
    - run qd_enderman_loaded_once delay:1s
    on enderman added to world:
    - if <list[world|world_nether|world_the_end].contains[<context.location.world.name>]>:
      # Addition fires before the entity is fully usable. Capture only its UUID
      # and re-check all eligibility conditions on the next tick.
      - run qd_enderman_clear_carried def:<context.entity.uuid> delay:1t

qd_enderman_loaded_once:
  type: task
  debug: false
  script:
  - foreach <server.worlds> as:loaded_world:
    - if <list[world|world_nether|world_the_end].contains[<[loaded_world].name>]>:
      - foreach <[loaded_world].entities[enderman]> as:target:
        - run qd_enderman_clear_carried def:<[target].uuid>
        - wait 1t

qd_enderman_clear_carried:
  type: task
  debug: false
  definitions: uuid
  script:
  # Fail closed: named, plugin-tagged, leashed, riding, custom-spawned or
  # explicitly persistent mobs are not changed. No kill, drops or rewards.
  - execute as_server 'minecraft:execute as <[uuid]> if entity @s[type=minecraft:enderman,nbt={carriedBlockState:{},PersistenceRequired:0b,"Paper.SpawnReason":"NATURAL"}] unless data entity @s CustomName unless data entity @s Tags unless data entity @s BukkitValues unless data entity @s Leash unless data entity @s Passengers unless data entity @s RootVehicle run minecraft:data remove entity @s carriedBlockState' silent
