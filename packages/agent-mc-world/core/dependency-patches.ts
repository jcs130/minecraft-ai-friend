/**
 * mineflayer-pathfinder 2.4.5、prismarine-windows 2.10.0 与 mineflayer 4.37.1 / 4.39.0 的源码补丁:包一层 CommonJS 的
 * `Module.prototype._compile`,编译前改写源码。要改的状态或监听器在闭包里,运行时替换函数够不着。
 * 补丁随 World 的源码走:World 作为扩展装进别的实例时,宿主的 pnpm 不会替它打包补丁。
 *
 * 引擎子进程以 `--import` 加载本模块;测试先 import 本模块再加载依赖。
 * 每处改写的原文必须在文件里恰好出现一次,依赖升级后对不上时加载即抛错。
 * 同一个 `/node_modules/<包>/<file>` 只能有一条 PATCHES 记录（patchFor 取第一条）；
 * 对该文件的全部改写（含载具/set_passengers 与 26.1 时序）必须写在同一条 edits 里。
 *
 * 三个包都是 MIT 许可;mineflayer-pathfinder 的许可全文见同目录 LICENSE-mineflayer-pathfinder.txt。
 */
import Module from 'node:module';

interface SourceEdit {
  find: string;
  replace: string;
}

interface SourcePatch {
  /** 包名;文件按 `/node_modules/<包名>/<file>` 结尾匹配。 */
  pkg: string;
  file: string;
  edits: readonly SourceEdit[];
}

const PATCHES: readonly SourcePatch[] = [
  {
    pkg: 'mineflayer-pathfinder',
    file: 'lib/astar.js',
    edits: [{
      find: `    path.push(node.data)`,
      replace: `    // A partial path is executable evidence, not the A* frontier itself.
    // Waypoint post-processing and execution mutate coordinates and action
    // arrays while later compute() slices still need the original grid nodes.
    path.push(Object.assign(Object.create(Object.getPrototypeOf(node.data)), node.data, {
      toBreak: [...node.data.toBreak],
      toPlace: node.data.toPlace.map(action => ({ ...action }))
    }))`,
    }],
  },
  {
    pkg: 'mineflayer-pathfinder',
    file: 'lib/movements.js',
    edits: [{
      find: `        if (node.y - blockLand.position.y <= this.maxDropDown) return this.getBlock(blockLand.position, 0, 1, 0)`,
      replace: `        if (node.y - blockLand.position.y <= this.maxDropDown) {
          const landing = this.getBlock(blockLand.position, 0, 1, 0)
          // Known support does not establish that the cell above it is loaded.
          // The missing-block sentinel has no position and cannot be a node.
          return landing.position ? landing : null
        }`,
    }],
  },
  {
    pkg: 'mineflayer-pathfinder',
    file: 'index.js',
    edits: [
      {
        // Human-pace movement (core/movement-pace.ts): while resting between legs/after a long walk, or
        // after a server anti-cheat warning, hold still without dropping the goal or its promise.
        find: `      } else if (stateGoal.hasChanged()) {
        resetPath('goal_moved', false)
      }
    }
`,
        replace: `      } else if (stateGoal.hasChanged()) {
        resetPath('goal_moved', false)
      }
    }
    if (stateGoal && typeof bot._pacePause === 'function' && bot._pacePause()) {
      bot.clearControlStates()
      return
    }
`,
      },
      {
        // fullStop() teleported the body to the block centre (when > 0.2 off) and zeroed its horizontal
        // velocity ("the server will not tell the difference"). Grim does: every such snap is a
        // flags-24 setback (live 26.1 trace: goto arrives, position jumps 0.5-0.7 m to x.5/z.5 in one
        // tick). Stop like a player releasing the keys; the body coasts out on vanilla friction.
        find: `    // Force horizontal velocity to 0 (otherwise inertia can move us too far)
    // Kind of cheaty, but the server will not tell the difference
    bot.entity.velocity.x = 0
    bot.entity.velocity.z = 0

    const blockX = Math.floor(bot.entity.position.x) + 0.5
    const blockZ = Math.floor(bot.entity.position.z) + 0.5

    // Make sure our bounding box don't collide with neighboring blocks
    // otherwise recenter the position
    if (Math.abs(bot.entity.position.x - blockX) > 0.2) { bot.entity.position.x = blockX }
    if (Math.abs(bot.entity.position.z - blockZ) > 0.2) { bot.entity.position.z = blockZ }`,
        replace: `    // No position snap or velocity reset: anticheats (Grim) set back any move the client did not simulate.`,
      },
      {
        find: `  const lockUseBlock = new Lock()`,
        replace: `  const lockUseBlock = new Lock()
  let useBlockGeneration = 0`,
      },
      {
        find: `    lockUseBlock.release()
    stateMovements.clearCollisionIndex()`,
        replace: `    useBlockGeneration++
    lockUseBlock.release()
    stateMovements.clearCollisionIndex()`,
      },
      {
        find: `      if (curPoint.toBreak.length > 0 || curPoint.toPlace.length > 0) break`,
        replace: `      // Opening a door does not create a floor. Keep centering existing
      // support after useOne; stop only at real terrain changes.
      if (curPoint.toBreak.length > 0 || curPoint.toPlace.some(action => !action.useOne)) break`,
      },
      {
        find: `      let np = getPositionOnTopOf(b)`,
        replace: `      // The rotating panel is a side obstruction, not the floor of a doorway.
      const doorway = b?.name?.endsWith('_door') || b?.name?.endsWith('_fence_gate')
      let np = doorway ? null : getPositionOnTopOf(b)`,
      },
      {
        find: `    if (astarContext && astartTimedout) {`,
        replace: `    if (astarContext && astartTimedout && !(placing && placingBlock?.useOne)) {`,
      },
      {
        find: `  bot.pathfinder.isBuilding = () => placing`,
        replace: `  bot.pathfinder.isBuilding = () => placing
  bot.pathfinder.isUsingBlock = () => placing && placingBlock?.useOne === true`,
      },
      {
        find: `    stateGoal = goal
    dynamicGoal = dynamic
    bot.emit('goal_updated', goal, dynamic)`,
        replace: `    stateGoal = goal
    dynamicGoal = dynamic
    // The return point belongs to the path of the previous goal. While it is
    // set, monitorMovement walks toward it and skips planning, so a point the
    // bot can no longer reach would stall every later goal.
    returningPos = null
    bot.emit('goal_updated', goal, dynamic)`,
      },
      {
        find: `        bot.activateBlock(bot.blockAt(new Vec3(placingBlock.x, placingBlock.y, placingBlock.z))).then(() => {
          lockUseBlock.release()
          placingBlock = nextPoint.toPlace.shift()
        }, err => {
          console.error(err)
          lockUseBlock.release()
        })`,
        replace: `        const interaction = placingBlock
        const generation = ++useBlockGeneration
        const target = bot.blockAt(new Vec3(interaction.x, interaction.y, interaction.z))
        const use = bot.cortiNavigateUse
          ? bot.cortiNavigateUse(target, interaction.expectedOpen)
          : bot.activateBlock(target)
        use.then(() => {
          if (generation !== useBlockGeneration) return
          lockUseBlock.release()
          if (path[0] !== nextPoint) {
            placing = false
            placingBlock = null
            return
          }
          if (astarContext && astartTimedout) {
            // The unfinished search saw the old panel; plan from its current state.
            resetPath('block_updated')
            return
          }
          placingBlock = nextPoint.toPlace.shift()
          if (!placingBlock) {
            placing = false
            lastNodeTime = performance.now()
          }
        }, err => {
          console.error(err)
          if (generation !== useBlockGeneration) return
          lockUseBlock.release()
          resetPath('interaction_error')
        })`,
      },
      {
        find: `    if (bot.entity.position.distanceSquared(targetPos) > minDistanceSq) {`,
        replace: `    // Horizontal distance only: a bot floating in water bobs above the node
    // and never comes within 0.2 of its feet height.
    const dx = bot.entity.position.x - targetPos.x
    const dz = bot.entity.position.z - targetPos.z
    if (dx * dx + dz * dz > minDistanceSq) {`,
      },
      {
        find: `    stateGoal = null
    path = []
    bot.emit('path_stop')`,
        replace: `    stateGoal = null
    returningPos = null
    path = []
    bot.emit('path_stop')`,
      },
      {
        find: `        fullStop()
      }

      // Open gates or doors`,
        replace: `        fullStop()
      }

      // The gate branch below reassigns placingBlock from toPlace.shift(),
      // which is undefined when the gate was the last entry. Nothing is left
      // to place for this node.
      if (!placingBlock) {
        placing = false
        return
      }

      // Open gates or doors`,
      },
      {
        find: `                lastNodeTime = performance.now()
              })
          })
          .catch(_ignoreError => {})`,
        replace: `                lastNodeTime = performance.now()
              })
          }, function (_ignoreError) {
            // Release the equip lock on rejection, retaining placement state
            // so the next tick can retry. Handle rejection in then's second
            // argument: the trailing catch also receives fulfilled-handler
            // errors, which must not release the lock twice.
            lockEquipItem.release()
          })
          .catch(_ignoreError => {})`,
      },
    ],
  },
  {
    pkg: 'mineflayer',
    file: 'lib/plugins/game.js',
    edits: [
      {
        find: `    if ((packet.reason === 4 || packet.reason === 'win_game') && packet.gameMode === 1) {
      bot._client.write('client_command', { action: 0 })
    }`,
        replace: `    // The server requests the same respawn after both the first credits
    // screen and later End exits. Use the field selected by the active codec.
    if (packet.reason === 4 || packet.reason === 'win_game') {
      bot._client.write('client_command', bot.supportFeature('respawnIsPayload') ? { payload: 0 } : { actionId: 0 })
    }`,
      },
    ],
  },
  {
    pkg: 'mineflayer',
    file: 'lib/plugins/physics.js',
    edits: [
      {
        find: `        shouldUsePhysics = true
        bot.jumpTicks = 0`,
        replace: `        // A delayed respawn position can arrive after set_passengers.
        // Confirm the packet, but do not simulate walking for a mounted rider.
        shouldUsePhysics = !bot.vehicle
        bot.jumpTicks = 0`,
      },
      {
        find: `    shouldUsePhysics = true
    bot.jumpTicks = 0`,
        replace: `    // Position acknowledgement does not revoke the server's vehicle attachment.
    shouldUsePhysics = !bot.vehicle
    bot.jumpTicks = 0`,
      },
      {
        find: `      tickPhysics(now)
      timeAccumulator -= PHYSICS_TIMESTEP`,
        // 1.21.2+ vanilla clients end every client tick with tick_end. Servers and
        // movement checks count ticks by it; without it an idle body is set back
        // (teleported to its own position) several times a second.
        // Every packet written between ticks (pongs, teleport replies, digs, uses, chat) is held until
        // the start of the next client tick and sent there in order, like the vanilla client, which
        // handles server packets and input at the start of Minecraft.runTick and moves afterwards
        // (mineflayer #4107). Grim's Post check flags actions that land between a movement packet
        // and the next transaction reply; answering pings mid-tick put digs exactly there.
        replace: `      bot._inClientTick = true
      try {
        if (bot._deferredWrites?.length && bot._client.state === 'play') {
          // Replies to server packets first (the packet queue), then this tick's input/actions.
          // Held packets already passed every outer write wrapper (inventory click guards, viewer
          // observers) when they were written; send them on the raw writer, never through the chain
          // again, and never let one bad packet throw out of the physics timer.
          const queued = bot._deferredWrites.splice(0)
          const send = ([name, params]) => { try { bot._writeNow(name, params) } catch (err) { bot.emit('deferredWriteError', err, name) } }
          for (const item of queued) if (item[2]) send(item)
          for (const item of queued) if (!item[2]) send(item)
        }
        if (bot._pendingPlayerInput && bot._client.state === 'play') { bot._client.write('player_input', bot._pendingPlayerInput); bot._pendingPlayerInput = null }
        // Start-of-tick hook (vanilla handleKeybinds/continueAttack): digging counts its ticks and
        // swings here, so dig packets keep the client tick cadence the server measures.
        bot._clientTicks = (bot._clientTicks | 0) + 1
        if (bot._client.state === 'play') bot.emit('clientTick')
        tickPhysics(now)
        if (bot._client.state === 'play' && bot.entity && bot.supportFeature('sendsClientTickEndPacket')) bot._client.write('tick_end', {})
      } finally {
        bot._inClientTick = false
      }
      timeAccumulator -= PHYSICS_TIMESTEP`,
      },
      {
        // mineflayer #4068 (merged after 4.39.0): drop the tick backlog after an event-loop stall
        // instead of draining it at maxCatchupTicks per interval. Draining a 1 s stall ran 80 ticks/s
        // for a quarter second; Grim's Timer (120 ms drift) flagged it and set the body back in place
        // (flags 24). Vanilla Minecraft.runTick likewise keeps only the fractional residual.
        find: `      if (catchupTicks >= PHYSICS_CATCHUP_TICKS) break
    }
  }`,
        replace: `      if (catchupTicks >= PHYSICS_CATCHUP_TICKS) break
    }
    timeAccumulator %= PHYSICS_TIMESTEP
  }`,
      },
      {
        // 26.1 maps entity_action ids 1/2 to start/stop sprinting; mineflayer's legacy 3/4 now
        // mean start/stop riding jump. On 1.21.2+ the sprint state is also no longer written from
        // setControlState (mid-tick, before the key state): vanilla LocalPlayer.aiStep decides it
        // and sendPosition reports it right before the movement packet (Grim flags "Post" otherwise).
        find: `    } else if (control === 'sprint') {
      bot._client.write('entity_action', {
        entityId: bot.entity.id,
        actionId: bot.supportFeature('entityActionUsesStringMapper')
          ? (state ? 'start_sprinting' : 'stop_sprinting')
          : (state ? 3 : 4),
        jumpBoost: 0
      })`,
        replace: `    } else if (control === 'sprint' && !bot.supportFeature('newPlayerInputPacket')) {
      bot._client.write('entity_action', {
        entityId: bot.entity.id,
        actionId: bot.supportFeature('entityActionUsesStringMapper')
          ? (state ? 'start_sprinting' : 'stop_sprinting')
          : (state ? 3 : 4),
        jumpBoost: 0
      })`,
      },
      {
        // Vanilla sprint rules (LocalPlayer.aiStep / canStartSprinting): the sprint key only starts a
        // sprint with forward impulse, no sneak, food > 6, no item in use and out of water; a wall,
        // sneak, hunger or losing forward impulse stops it. The local simulation uses the same state
        // the server is told, so sprint speed is never predicted for backwards/sideways/blocked moves.
        find: `  function tickPhysics (now) {`,
        replace: `  if (bot.supportFeature('sendsClientTickEndPacket') && !bot._deferredWrites) {
    bot._deferredWrites = []
    const writeNow = bot._client.write.bind(bot._client)
    bot._writeNow = writeNow
    bot._client.write = (name, params) => {
      if (bot._inClientTick || bot._client.state !== 'play' || doPhysicsTimer === null || bot._client.ended) return writeNow(name, params)
      bot._deferredWrites.push([name, params, name === 'pong' || name === 'keep_alive' || name === 'teleport_confirm' || name === 'chunk_batch_received' || !!bot._teleportReply])
    }
    bot._client.on('state', (state) => { if (state !== 'play' && bot._deferredWrites.length) bot._deferredWrites.length = 0 })
  }
  let modernSprinting = false
  let sentSprinting = false
  function modernSprintControls () {
    const e = bot.entity
    const creative = bot.game?.gameMode === 'creative'
    const foodOk = creative || typeof bot.food !== 'number' || bot.food > 6
    const forward = controlState.forward && !controlState.back
    const blocked = !forward || controlState.sneak || !foodOk || e.isInWater || e.isInLava || bot.usingHeldItem
    if (modernSprinting) {
      if (blocked || e.isCollidedHorizontally) modernSprinting = false
    } else if (controlState.sprint && !blocked && !e.isCollidedHorizontally) {
      modernSprinting = true
    }
    return modernSprinting === controlState.sprint ? controlState : Object.assign({}, controlState, { sprint: modernSprinting })
  }
  bot._modernSprinting = () => modernSprinting
  // Vanilla client LivingEntity.pushEntities / Entity.push: every living entity (and player) whose
  // box overlaps the local player pushes it away by 0.05/sqrt(absMax(dx, dz)) per tick, subject to
  // the team collision rules (EntitySelector.pushableBy). Grim predicts the push; standing still
  // inside AFK players at spawn was a setback every second.
  const NO_PUSH = new Set(['armor_stand', 'item', 'experience_orb', 'arrow', 'boat', 'minecart', 'item_frame', 'painting', 'falling_block', 'tnt', 'marker', 'interaction', 'item_display', 'block_display', 'text_display', 'area_effect_cloud', 'bat', 'parrot'])
  const ruleOf = (team) => { const r = team?.collisionRule; return r === undefined || r === null ? 0 : typeof r === 'number' ? r : ({ always: 0, never: 1, pushOtherTeams: 2, pushOwnTeam: 3 })[r] ?? 0 }
  function modernEntityPush () {
    const me = bot.entity
    if (!me || me.vehicle || bot.game?.gameMode === 'spectator') return
    const teams = bot.teamMap || {}
    const myTeam = teams[bot.username]
    const myRule = ruleOf(myTeam)
    if (myRule === 1) return
    const hw = Math.fround(0.6) / 2
    const h = me.height || 1.8
    for (const e of Object.values(bot.entities || {})) {
      if (!e || e === me || !e.position || e.isValid === false) continue
      if (!(e.type === 'player' || e.type === 'mob' || e.type === 'hostile' || e.type === 'animal' || e.type === 'passive' || e.type === 'water_creature' || e.type === 'ambient')) continue
      if (NO_PUSH.has(e.name)) continue
      if (e.metadata && e.type !== 'player' && typeof e.health === 'number' && e.health <= 0) continue
      const ew = (e.width || 0.6) / 2
      const eh = e.height || 1.8
      if (!(e.position.x - ew < me.position.x + hw && e.position.x + ew > me.position.x - hw &&
        e.position.z - ew < me.position.z + hw && e.position.z + ew > me.position.z - hw &&
        e.position.y < me.position.y + h && e.position.y + eh > me.position.y)) continue
      const otherTeam = e.type === 'player' ? teams[e.username] : teams[e.uuid]
      const otherRule = ruleOf(otherTeam)
      if (otherRule === 1) continue
      const same = !!myTeam && myTeam === otherTeam
      if ((myRule === 3 || otherRule === 3) && !same) continue
      if ((myRule === 2 || otherRule === 2) && same) continue
      let xa = e.position.x - me.position.x
      let za = e.position.z - me.position.z
      let dd = Math.max(Math.abs(xa), Math.abs(za))
      if (dd < Math.fround(0.01)) continue
      dd = Math.sqrt(dd)
      xa /= dd
      za /= dd
      const pow = Math.min(1, 1 / dd)
      xa *= pow * Math.fround(0.05)
      za *= pow * Math.fround(0.05)
      me.velocity.x -= xa
      me.velocity.z -= za
    }
  }
  const resetModernSprint = () => {
    modernSprinting = false
    sentSprinting = false
    // A new player entity starts airborne (Entity.onGround starts false).
    if (bot.entity && bot.supportFeature('sendsClientTickEndPacket')) bot.entity.onGround = false
  }
  bot.on('respawn', resetModernSprint)
  bot.on('login', resetModernSprint)

  function tickPhysics (now) {`,
      },
      {
        find: `      physics.simulatePlayer(new PlayerState(bot, controlState), world).apply(bot)`,
        // Remember the rotation this tick moved with: physicsTick listeners (pathfinder, skills) turn
        // the body after the move, and the packet must carry the rotation the server should predict
        // this move with (vanilla turns before travel). The new rotation goes out with the next move.
        replace: `      bot._simRotation = bot.supportFeature('sendsClientTickEndPacket') ? [bot.entity.yaw, bot.entity.pitch] : null
      physics.simulatePlayer(new PlayerState(bot, bot.supportFeature('newPlayerInputPacket') ? modernSprintControls() : controlState), world).apply(bot)
      if (bot.supportFeature('newPlayerInputPacket')) modernEntityPush()`,
      },
      {
        find: `    if (shouldUsePhysics) {
      updatePosition(now)`,
        replace: `    if (shouldUsePhysics) {
      if (bot.supportFeature('newPlayerInputPacket') && modernSprinting !== sentSprinting && bot.entity) {
        bot._client.write('entity_action', { entityId: bot.entity.id, actionId: modernSprinting ? 'start_sprinting' : 'stop_sprinting', jumpBoost: 0 })
        sentSprinting = modernSprinting
      }
      updatePosition(now)`,
      },
      {
        // 1.21.2+ servers predict each tick with the rotation in that tick's movement packet.
        // Slewing the sent yaw toward the target while simulating with the target yaw makes a
        // persistent offset (mineflayer PR #3949). Also keep the sent yaw continuous: a jump of
        // 360 degrees between packets is flagged (AimModulo360) although it is the same direction.
        find: `    lastSentYaw += math.clamp(-maxDeltaYaw, dYaw, maxDeltaYaw)
    lastSentPitch += math.clamp(-maxDeltaPitch, dPitch, maxDeltaPitch)

    const yaw = Math.fround(conv.toNotchianYaw(lastSentYaw))`,
        replace: `    const modernRotation = bot.supportFeature('sendsClientTickEndPacket')
    if (modernRotation) {
      const sim = bot._simRotation
      bot._simRotation = null
      lastSentYaw = sim ? sim[0] : bot.entity.yaw
      lastSentPitch = sim ? sim[1] : bot.entity.pitch
    } else {
      lastSentYaw += math.clamp(-maxDeltaYaw, dYaw, maxDeltaYaw)
      lastSentPitch += math.clamp(-maxDeltaPitch, dPitch, maxDeltaPitch)
    }

    const rawYaw = conv.toNotchianYaw(lastSentYaw)
    const yaw = Math.fround(modernRotation && Number.isFinite(lastSent.yaw)
      ? lastSent.yaw + ((((rawYaw - lastSent.yaw) % 360) + 540) % 360 - 180)
      : rawYaw)`,
      },
      {
        // ClientPacketListener.handleMovePlayer sets position, velocity and rotation only; whether
        // the body stands is left to the next tick's move (mineflayer #4108). Forcing it airborne made
        // the next tick use air friction while the server predicted ground: a setback answered by
        // another mismatch, every tick, for as long as a key was held (the "setback storm").
        find: `    bot.entity.onGround = false

    if (bot.supportFeature('teleportUsesOwnPacket')) {`,
        replace: `    if (!bot.supportFeature('sendsClientTickEndPacket')) bot.entity.onGround = false

    if (bot.supportFeature('teleportUsesOwnPacket')) {`,
      },
      {
        find: `      const delayedOnGround = bot.entity.onGround`,
        replace: `      const delayedOnGround = bot.supportFeature('sendsClientTickEndPacket') ? false : bot.entity.onGround`,
      },
      {
        // The vanilla teleport reply is PosRot(pos, rot, onGround=false, horizontalCollision=false);
        // it does not change what the next tick compares against for the on-ground status.
        find: `    sendPacketPositionAndLook(pos, newYaw, newPitch, bot.entity.onGround)`,
        replace: `    if (bot.supportFeature('sendsClientTickEndPacket')) {
      const keepGround = lastSent.onGround
      bot._teleportReply = true
      try { sendPacketPositionAndLook(pos, newYaw, newPitch, false) } finally { bot._teleportReply = false }
      lastSent.onGround = keepGround
    } else {
      sendPacketPositionAndLook(pos, newYaw, newPitch, bot.entity.onGround)
    }`,
      },
      {
        // 1.21.6+ entity_action has no elytra id 8 (now start_fall_flying).
        find: `      actionId: bot.supportFeature('entityActionUsesStringMapper') ? 'start_elytra_flying' : 8,`,
        replace: `      actionId: bot.supportFeature('entityActionUsesStringMapper') ? 'start_elytra_flying' : bot.supportFeature('newPlayerInputPacket') ? 'start_fall_flying' : 8,`,
      },
      {
        // 1.21.6+ vanilla reports the whole key state (move, jump, sneak, sprint) in player_input
        // whenever it changes; mineflayer sent only sneak and cleared every other key.
        find: `    if (controlState[control] === state) return
    controlState[control] = state
    if (control === 'jump' && state) {`,
        replace: `    if (controlState[control] === state) return
    controlState[control] = state
    if (bot.supportFeature('newPlayerInputPacket')) {
      // Coalesced: vanilla sends the key state at most once per client tick, before movement.
      bot._pendingPlayerInput = { inputs: { forward: controlState.forward, backward: controlState.back,
        left: controlState.left, right: controlState.right, jump: controlState.jump, shift: controlState.sneak, sprint: controlState.sprint } }
    }
    if (control === 'jump' && state) {`,
      },
      {
        // 1.21.2+ teleports carry a velocity (dx/dy/dz) with its own relative flags. Mineflayer
        // zeroed it (old semantics), so after every anti-cheat setback the body restarted from
        // rest while the server predicted it kept its momentum: one setback caused the next.
        find: `      vel.set(
        packet.flags.x ? vel.x : 0,
        packet.flags.y ? vel.y : 0,
        packet.flags.z ? vel.z : 0
      )`,
        replace: `      if (typeof packet.dx === 'number' && typeof packet.dy === 'number' && typeof packet.dz === 'number') {
        vel.set(
          packet.flags.dx ? vel.x + packet.dx : packet.dx,
          packet.flags.dy ? vel.y + packet.dy : packet.dy,
          packet.flags.dz ? vel.z + packet.dz : packet.dz
        )
      } else {
        vel.set(
          packet.flags.x ? vel.x : 0,
          packet.flags.y ? vel.y : 0,
          packet.flags.z ? vel.z : 0
        )
      }`,
      },
      {
        // Movement packets report horizontal collision (1.21.2+), as vanilla does.
        find: `    lastSent.flags = { onGround, hasHorizontalCollision: undefined } // 1.21.3+
    bot._client.write('position', lastSent)`,
        replace: `    lastSent.flags = { onGround, hasHorizontalCollision: !!bot.entity?.isCollidedHorizontally } // 1.21.3+
    bot._client.write('position', lastSent)`,
      },
      {
        find: `    lastSent.flags = { onGround, hasHorizontalCollision: undefined } // 1.21.3+
    bot._client.write('look', lastSent)`,
        replace: `    lastSent.flags = { onGround, hasHorizontalCollision: !!bot.entity?.isCollidedHorizontally } // 1.21.3+
    bot._client.write('look', lastSent)`,
      },
      {
        find: `    lastSent.flags = { onGround, hasHorizontalCollision: undefined } // 1.21.3+
    bot._client.write('position_look', lastSent)`,
        replace: `    lastSent.flags = { onGround, hasHorizontalCollision: !bot._teleportReply && !!bot.entity?.isCollidedHorizontally } // 1.21.3+
    bot._client.write('position_look', lastSent)`,
      },
      {
        find: `        bot._client.write('player_input', {
          inputs: {
            shift: state
          }
        })`,
        replace: `        // player_input with the full key state was already sent above`,
      },
    ],
  },
  {
    pkg: 'mineflayer',
    file: 'lib/plugins/digging.js',
    // 1.19+ vanilla numbers every predicted block action (dig start/stop/finish, use-on-block)
    // from one counter and the server acknowledges it; mineflayer sends 0 every time, so the
    // server never acks and movement/anti-cheat state can lag behind the break.
    edits: [
      {
        // Default ('auto') dig always reported the TOP face. Breaking a block at or above eye
        // height then names a face the player cannot see; movement/anti-cheat checks reject the
        // break and the server puts the block back. Report the face the look ray enters, as vanilla.
        find: `      } else {
        await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), forceLook)
      }
    }
`,
        replace: `      } else {
        await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), forceLook)
        if (bot.entity?.position) {
          const ex = bot.entity.position.x - (block.position.x + 0.5)
          const ey = bot.entity.position.y + (bot.entity.eyeHeight ?? 1.62) - (block.position.y + 0.5)
          const ez = bot.entity.position.z - (block.position.z + 0.5)
          const ax = Math.abs(ex), ay = Math.abs(ey), az = Math.abs(ez)
          bot.targetDigFace = ay >= ax && ay >= az ? (ey > 0 ? BlockFaces.TOP : BlockFaces.BOTTOM)
            : ax >= az ? (ex > 0 ? BlockFaces.EAST : BlockFaces.WEST) : (ez > 0 ? BlockFaces.SOUTH : BlockFaces.NORTH)
        }
      }
    }
`,
      },
      {
        // 26.1 Player.getDestroySpeed / BlockState.getDestroyProgress, as Grim's BlockBreakSpeed:
        // tool speed (+ mining_efficiency attribute when > 1), haste/conduit (+0.2 per level),
        // mining fatigue, block_break_speed, submerged_mining_speed when the eyes are in water,
        // x0.2 off the ground; hardness and 30 (correct tool) or 100. Float math like the game.
        find: `  function digTime (block) {
    let type = null`,
        replace: `  function attributeValue (key, fallback) {
    const a = bot.entity?.attributes?.[key]
    if (!a || typeof a.value !== 'number') return fallback
    let base = a.value
    const mods = a.modifiers || []
    for (const m of mods) if (m.operation === 0 || m.operation === 'add_value' || m.operation === 'add') base += m.amount
    let v = base
    for (const m of mods) if (m.operation === 1 || m.operation === 'add_multiplied_base' || m.operation === 'multiply_base') v += base * m.amount
    for (const m of mods) if (m.operation === 2 || m.operation === 'add_multiplied_total' || m.operation === 'multiply') v *= 1 + m.amount
    return v
  }
  function effectLevel (name) {
    const id = bot.registry.effectsByName[name]?.id
    const e = id === undefined ? undefined : bot.entity?.effects?.[id]
    return e ? e.amplifier + 1 : 0
  }
  function modernDigTicks (block) {
    if (bot.game?.gameMode === 'creative') return 0
    const hardness = block.hardness
    if (hardness === -1 || hardness === null || hardness === undefined) return Infinity
    const held = bot.heldItem
    const mats = bot.registry.materials?.[block.material]
    let speed = held && mats && mats[held.type] ? Math.fround(mats[held.type]) : 1
    if (speed > 1) {
      const enchEff = (held?.enchants || []).find((e) => e.name === 'efficiency')?.lvl || 0
      speed = Math.fround(speed + Math.fround(attributeValue('minecraft:mining_efficiency', enchEff > 0 ? enchEff * enchEff + 1 : 0)))
    }
    const haste = Math.max(effectLevel('Haste'), effectLevel('ConduitPower'))
    if (haste > 0) speed = Math.fround(speed * Math.fround(1 + 0.2 * haste))
    const fatigue = effectLevel('MiningFatigue')
    if (fatigue > 0) speed = Math.fround(speed * [0.3, 0.09, 0.0027, 0.00081][Math.min(fatigue, 4) - 1])
    speed = Math.fround(speed * Math.fround(attributeValue('minecraft:block_break_speed', 1)))
    const eye = bot._getBlockAtEyeLevel()
    if (eye && (eye.name === 'water' || eye.name === 'flowing_water' || eye.getProperties?.().waterlogged === true)) {
      const helmet = bot.inventory.slots[bot.getEquipmentDestSlot('head')]
      const aqua = (helmet?.enchants || []).some((e) => e.name === 'aqua_affinity')
      speed = Math.fround(speed * Math.fround(attributeValue('minecraft:submerged_mining_speed', aqua ? 1 : 0.2)))
    }
    if (!bot.entity.onGround) speed = Math.fround(speed * Math.fround(0.2))
    const delta = Math.fround(Math.fround(speed / Math.fround(hardness)) / (block.canHarvest(held ? held.type : null) ? 30 : 100))
    if (delta <= 0) return Infinity
    if (delta >= 1) return 0
    return Math.ceil(1 / delta)
  }
  bot._modernDigTicks = modernDigTicks
  function digTime (block) {
    if (bot.supportFeature('newPlayerInputPacket')) { const t = modernDigTicks(block); return t === Infinity ? Infinity : t * 50 }
    let type = null`,
      },
      {
        // Vanilla waits destroyDelay (5 ticks) after a break before the next START; Grim FastBreak
        // adds 300 ms - gap for every START closer than 275 ms after the last FINISH.
        find: `    if (bot.targetDigBlock) bot.stopDigging()

    diggingTask = createTask()`,
        replace: `    if (bot.targetDigBlock) bot.stopDigging()
    const tickedDigging = bot.supportFeature('newPlayerInputPacket') && bot._clientTicks !== undefined
    if (tickedDigging && bot._lastDigEndTick !== undefined && bot._clientTicks - bot._lastDigEndTick < 6) {
      await new Promise((resolve) => {
        const done = () => { bot.removeListener('clientTick', check); clearTimeout(guard); resolve() }
        const check = () => { if (bot._clientTicks - bot._lastDigEndTick >= 6) done() }
        const guard = setTimeout(done, 1000)
        bot.on('clientTick', check)
      })
    }
    // Vanilla instant break: only START is sent and the block is predicted gone (no FINISH).
    const digInstant = tickedDigging && waitTime === 0

    diggingTask = createTask()`,
      },
      {
        // Count client ticks from the tick START went out and finish one tick after vanilla would
        // (ceil(1/progress) ticks): Grim FastBreak adds predicted - real ms to its balance for every
        // FINISH more than 25 ms early, and a free-running setTimeout plus the next-tick write
        // landed up to 50 ms early about half the time. Swing every digging tick like
        // Minecraft.continueAttack instead of every 350 ms.
        find: `    waitTimeout = setTimeout(finishDigging, waitTime)
    bot.targetDigBlock = block
    bot.swingArm()

    swingInterval = setInterval(() => {
      bot.swingArm()
    }, 350)
`,
        replace: `    bot.targetDigBlock = block
    bot.swingArm()
    if (digInstant) {
      // After the blockUpdate listener below is registered, so the predicted air resolves the dig.
      queueMicrotask(() => { if (bot.targetDigBlock === block) finishDigging() })
    } else if (tickedDigging) {
      const ticks = Math.round(waitTime / 50)
      let seen = 0
      const onTick = () => {
        if (bot.targetDigBlock !== block) { bot.removeListener('clientTick', onTick); return }
        seen++
        if (seen >= ticks + 2) { bot.removeListener('clientTick', onTick); finishDigging(); return }
        if (seen > 1) bot.swingArm()
      }
      bot.on('clientTick', onTick)
      // Fallback if the tick loop stops (disconnect): never hang the dig.
      waitTimeout = setTimeout(() => { bot.removeListener('clientTick', onTick); finishDigging() }, waitTime + 3000)
    } else {
      waitTimeout = setTimeout(finishDigging, waitTime)
      swingInterval = setInterval(() => {
        bot.swingArm()
      }, 350)
    }
`,
      },
      {
        find: `      if (bot.targetDigBlock) {
        bot._client.write('block_dig', {`,
        replace: `      if (bot.targetDigBlock && !digInstant) {
        bot._client.write('block_dig', {`,
      },
      {
        find: `      bot.lastDigTime = performance.now()
      bot._updateBlockState(block.position, 0)`,
        replace: `      bot.lastDigTime = performance.now()
      bot._lastDigEndTick = bot._clientTicks
      bot._updateBlockState(block.position, 0)`,
      },
      { find: `      status: 0, // start digging`, replace: `      status: 0, // start digging
      sequence: (bot._predictionSequence = (bot._predictionSequence | 0) + 1),` },
      { find: `          status: 2, // finish digging`, replace: `          status: 2, // finish digging
          sequence: (bot._predictionSequence = (bot._predictionSequence | 0) + 1),` },
      { find: `        status: 1, // cancel digging`, replace: `        status: 1, // cancel digging
        sequence: (bot._predictionSequence = (bot._predictionSequence | 0) + 1),` },
    ],
  },
  {
    pkg: 'mineflayer',
    file: 'lib/plugins/generic_place.js',
    // use_item_on is a predicted block action: it takes the next number of the shared sequence
    // (vanilla BlockStatePredictionHandler); mineflayer sent 0 for every placement.
    edits: [{ find: `        sequence: 0, // 1.19.0`, replace: `        sequence: (bot._predictionSequence = (bot._predictionSequence | 0) + 1), // 1.19.0` }],
  },
  {
    pkg: 'mineflayer',
    file: 'lib/plugins/inventory.js',
    edits: [
      { find: `    bot.usingHeldItem = true
    sequence++`, replace: `    bot.usingHeldItem = true
    sequence = bot._predictionSequence = Math.max(sequence, bot._predictionSequence | 0) + 1` },
      { find: `        sequence: 0, // 1.19.0+`, replace: `        sequence: (bot._predictionSequence = (bot._predictionSequence | 0) + 1), // 1.19.0+` },
    ],
  },
  {
    pkg: 'prismarine-windows',
    file: 'index.js',
    edits: [
      {
        find: `      windows['minecraft:smithing'] = { type: protocolId++, inventory: { start: 3, end: 38 }, slots: 39, craft: 2, requireConfirmation: true }`,
        replace: `      // 1.20 adds the template slot: template 0, base 1, addition 2, result 3
      windows['minecraft:smithing'] = registry.version['>=']('1.20')
        ? { type: protocolId++, inventory: { start: 4, end: 39 }, slots: 40, craft: 3, requireConfirmation: true }
        : { type: protocolId++, inventory: { start: 3, end: 38 }, slots: 39, craft: 2, requireConfirmation: true }`,
      },
    ],
  },
  {
    pkg: 'mineflayer',
    file: 'lib/plugins/entities.js',
    edits: [
      {
      find: `    const passengerEntities = passengers.map((passengerId) => fetchEntity(passengerId))
    const vehicle = entityId === -1 ? null : bot.entities[entityId]

    for (const passengerEntity of passengerEntities) {
      const originalVehicle = passengerEntity.vehicle
      if (originalVehicle) {
        const index = originalVehicle.passengers.indexOf(passengerEntity)
        originalVehicle.passengers.splice(index, 1)
      }
      passengerEntity.vehicle = vehicle
      if (vehicle) {
        vehicle.passengers.push(passengerEntity)
      }
    }

    if (passengers.includes(bot.entity.id)) {
      const originalVehicle = bot.vehicle
      if (entityId === -1) {
        bot.vehicle = null
        bot.emit('dismount', originalVehicle)
      } else {
        bot.vehicle = bot.entities[entityId]
        bot.emit('mount')
      }
    }`,
      replace: `    const passengerEntities = [...new Set(passengers)].map((id) => fetchEntity(id))
    const vehicle = entityId === -1 ? null : bot.entities[entityId]
    const originalSelfVehicle = bot.vehicle
    // set_passengers is a full snapshot, including the empty list on dismount.
    if (vehicle) {
      for (const old of vehicle.passengers || []) {
        if (!passengerEntities.includes(old) && old.vehicle === vehicle) old.vehicle = null
      }
      vehicle.passengers = []
    }
    for (const passengerEntity of passengerEntities) {
      const originalVehicle = passengerEntity.vehicle
      if (originalVehicle && originalVehicle !== vehicle) {
        const index = originalVehicle.passengers.indexOf(passengerEntity)
        if (index >= 0) originalVehicle.passengers.splice(index, 1)
      }
      passengerEntity.vehicle = vehicle
      if (vehicle) vehicle.passengers.push(passengerEntity)
    }
    if (passengers.includes(bot.entity.id)) {
      bot.vehicle = vehicle
    } else if (vehicle && originalSelfVehicle === vehicle) {
      bot.vehicle = null
    }
    if (bot.vehicle !== originalSelfVehicle) {
      if (bot.vehicle) bot.emit('mount')
      else if (originalSelfVehicle) bot.emit('dismount', originalSelfVehicle)
    }`,
    },

      {
        // 1.21.9+ sends entity velocity as lpVec3, which minecraft-protocol already decodes to
        // blocks/tick; mineflayer still divided by 8000 (the old short encoding), so knockback and
        // the velocity Grim sends right after a setback (SetbackTeleportUtil -> EntityVelocity) were
        // lost. The next tick then disagreed with the server again: a setback loop, worst in water.
        find: `      entity.velocity.update(conv.fromNotchVelocity(new Vec3(packet.velocity.x, packet.velocity.y, packet.velocity.z)))`,
        replace: `      entity.velocity.update(lpVelocity('packet_spawn_entity') ? new Vec3(packet.velocity.x, packet.velocity.y, packet.velocity.z) : conv.fromNotchVelocity(new Vec3(packet.velocity.x, packet.velocity.y, packet.velocity.z)))`,
      },
      {
        find: `    const entity = fetchEntity(packet.entityId)
    const notchVel = new Vec3(packet.velocity.x, packet.velocity.y, packet.velocity.z)
    entity.velocity.update(conv.fromNotchVelocity(notchVel))`,
        replace: `    const entity = fetchEntity(packet.entityId)
    const notchVel = new Vec3(packet.velocity.x, packet.velocity.y, packet.velocity.z)
    entity.velocity.update(lpVelocity('packet_entity_velocity') ? notchVel : conv.fromNotchVelocity(notchVel))`,
      },
      {
        find: `  const updateAttributes = (packet) => {`,
        replace: `  const lpVelocityCache = {}
  function lpVelocity (type) {
    if (!(type in lpVelocityCache)) {
      try { lpVelocityCache[type] = JSON.stringify(bot.registry.protocol?.play?.toClient?.types?.[type] ?? null).includes('"lpVec3"') } catch (err) { lpVelocityCache[type] = false }
    }
    return lpVelocityCache[type]
  }
  const updateAttributes = (packet) => {`,
      },
      {
        // minecraft-data 3.117's 26.1 protocol maps attribute ids with a stale 31-entry table
        // (no mining_efficiency, movement_efficiency, oxygen_bonus, sneaking_speed), so every id from
        // 20 up lands on the wrong name: movement_speed arrived as "generic.scale" and physics never
        // saw server speed modifiers. Re-key by the registry index (attributes.json order), using the
        // resource name prismarine-physics looks up ("minecraft:movement_speed").
        find: `  const updateAttributes = (packet) => {
    const entity = fetchEntity(packet.entityId)
    if (!entity.attributes) entity.attributes = {}
    for (const prop of packet.properties) {
      entity.attributes[prop.key] = {`,
        replace: `  const attributeKeyFix = (() => {
    try {
      if (!bot.supportFeature('sendsClientTickEndPacket')) return null
      const t = bot.registry.protocol?.play?.toClient?.types?.packet_entity_update_attributes
      const props = t?.[1]?.find((f) => f.name === 'properties')
      const key = props?.type?.[1]?.type?.[1]?.find((f) => f.name === 'key')
      const mappings = key?.type?.[1]?.mappings
      const list = bot.registry.attributesArray
      if (!mappings || !list?.length) return null
      const out = {}
      for (const [i, name] of Object.entries(mappings)) if (list[Number(i)]?.resource) out[name] = list[Number(i)].resource
      return out
    } catch (err) { return null }
  })()
  const updateAttributes = (packet) => {
    const entity = fetchEntity(packet.entityId)
    if (!entity.attributes) entity.attributes = {}
    for (const prop of packet.properties) {
      entity.attributes[(typeof prop.key === 'number' ? bot.registry.attributesArray?.[prop.key]?.resource : attributeKeyFix?.[prop.key]) ?? prop.key] = {`,
      },
    ],
  },
  {
    pkg: 'prismarine-physics',
    file: 'index.js',
    edits: [
      {
        // Server attributes drive vanilla movement (LivingEntity: step_height, gravity, jump_strength,
        // sneaking_speed); a modded server may change any of them. Defaults equal the old constants.
        find: `  physics.simulatePlayer = (entity, world) => {`,
        replace: `  function attributeOf (entity, resource, fallback) {
    const a = entity?.attributes?.[resource]
    if (!a || !Number.isFinite(a.value)) return fallback
    return attribute.getAttributeValue(a)
  }
  const modernMovementThreshold = !!(mcData.version && typeof mcData.version['>='] === 'function' && mcData.version['>=']('1.21.5'))

  physics.simulatePlayer = (entity, world) => {`,
      },
      {
        // Modern (1.13+) vanilla water, used for 1.21.5+: Entity.updateFluidHeightAndDoFluidPushing touches
        // water when a fluid surface (y + own height, 1 under more water) reaches the box deflated by
        // 0.001, records the fluid height (for the 0.4 jump threshold) and averages the flow pushes.
        // LivingEntity.travelInWater: speed 0.02, slow-down 0.8 (water_movement_efficiency /
        // dolphins grace), vertical *0.8 then gravity/16 (getFluidFallingAdjustedMovement), +0.3 when
        // a wall can be climbed out. prismarine-physics used the 1.12 rules (box shrunk 0.4 vertically,
        // 0.02 sinking), so a swimming body never matched the server and was set back every tick.
        find: `  physics.simulatePlayer = (entity, world) => {
    const vel = entity.vel
    const pos = entity.pos

    const waterBB = getPlayerBB(pos).contract(0.001, 0.401, 0.001)
    const lavaBB = getPlayerBB(pos).contract(0.1, 0.4, 0.1)

    entity.isInWater = isInWaterApplyCurrent(world, waterBB, vel)`,
        replace: `  function isWaterBlock (block) {
    return !!block && (waterIds.includes(block.type) || waterLike.has(block.type) || !!block.isWaterlogged)
  }
  // FlowingFluid.getFlow (26.1). prismarine used the 1.12 rule, which looked under a SOLID neighbour
  // (vanilla looks under a neighbour that does not block motion) and re-applied the falling -6 per
  // side, so water beside ice, snow or stone pushed a standing body the server kept still.
  function modernOwnHeight (block) {
    if (!isWaterBlock(block)) return 0
    const meta = waterIds.includes(block.type) ? (block.metadata | 0) : 0
    return Math.fround((meta === 0 || meta >= 8 ? 8 : 8 - meta) / 9)
  }
  function modernGetFlow (world, block) {
    const own = modernOwnHeight(block)
    let fx = 0; let fz = 0
    const p = block.position
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const n = world.getBlock(p.offset(dx, 0, dz))
      if (n && n.name === 'lava') continue
      let nh = modernOwnHeight(n)
      let dist = 0
      if (nh === 0) {
        if (!n || n.boundingBox !== 'block') {
          const below = world.getBlock(p.offset(dx, -1, dz))
          if (!(below && below.name === 'lava')) {
            nh = modernOwnHeight(below)
            if (nh > 0) dist = Math.fround(own - Math.fround(nh - Math.fround(0.8888889)))
          }
        }
      } else {
        dist = Math.fround(own - nh)
      }
      if (dist !== 0) { fx += dx * dist; fz += dz * dist }
    }
    let fy = 0
    const falling = waterIds.includes(block.type) && (block.metadata | 0) >= 8
    if (falling) {
      const solidFace = (b, up) => !!b && !isWaterBlock(b) && (up || (b.name !== 'ice' && b.name !== 'frosted_ice' && b.boundingBox === 'block'))
      for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        if (solidFace(world.getBlock(p.offset(dx, 0, dz)), false) || solidFace(world.getBlock(p.offset(dx, 1, dz)), false)) {
          const l = Math.sqrt(fx * fx + fz * fz)
          if (l < 1e-4) { fx = 0; fz = 0 } else { fx /= l; fz /= l }
          fy = -6
          break
        }
      }
    }
    const l = Math.sqrt(fx * fx + fy * fy + fz * fz)
    return l < 1e-4 ? new Vec3(0, 0, 0) : new Vec3(fx / l, fy / l, fz / l)
  }
  function modernWaterState (world, bb, vel, entity) {
    // EntityFluidInteraction.update / Tracker.applyCurrentTo (26.1): height is measured from the
    // real box bottom, the flow of a block is scaled by the running height while it is under 0.4,
    // in water means height > 0, and a summed current under 1e-5 (squared) pushes nothing.
    const entityY = bb.minY - 0.001
    let height = 0
    let count = 0
    let px = 0; let py = 0; let pz = 0
    const cursor = new Vec3(0, 0, 0)
    for (cursor.y = Math.floor(bb.minY); cursor.y < Math.ceil(bb.maxY); cursor.y++) {
      for (cursor.z = Math.floor(bb.minZ); cursor.z < Math.ceil(bb.maxZ); cursor.z++) {
        for (cursor.x = Math.floor(bb.minX); cursor.x < Math.ceil(bb.maxX); cursor.x++) {
          const block = world.getBlock(cursor)
          if (!isWaterBlock(block)) continue
          const meta = waterIds.includes(block.type) ? (block.metadata | 0) : 0
          const amount = meta >= 8 || meta === 0 ? 8 : 8 - meta
          const fh = isWaterBlock(world.getBlock(cursor.offset(0, 1, 0))) ? 1 : amount / 9
          const top = cursor.y + fh
          if (top < bb.minY) continue
          height = Math.max(top - entityY, height)
          const flow = modernGetFlow(world, block)
          const f = height < 0.4 ? height : 1
          if (Number.isFinite(flow.x)) { px += flow.x * f; py += flow.y * f; pz += flow.z * f }
          count++
        }
      }
    }
    const inWater = height > 0
    if (inWater && count > 0 && !(px * px + py * py + pz * pz < Math.fround(1e-5))) {
      px = px / count * 0.014; py = py / count * 0.014; pz = pz / count * 0.014
      const len = Math.sqrt(px * px + py * py + pz * pz)
      if (Math.abs(vel.x) < 0.003 && Math.abs(vel.z) < 0.003 && len < 0.0045000000000000005) { px = px / len * 0.0045000000000000005; py = py / len * 0.0045000000000000005; pz = pz / len * 0.0045000000000000005 }
      vel.x += px; vel.y += py; vel.z += pz
    }
    entity.waterHeight = height
    return inWater
  }
  function modernTravelInWater (entity, world, strafe, forward) {
    const vel = entity.vel
    const pos = entity.pos
    const falling = vel.y <= 0
    const oldY = pos.y
    let slowDown = entity.control.sprint ? Math.fround(0.9) : Math.fround(0.8)
    let speed = Math.fround(0.02)
    let eff = attributeOf(entity, 'minecraft:water_movement_efficiency', Math.min(entity.depthStrider || 0, 3) / 3)
    if (!entity.onGround) eff *= 0.5
    if (eff > 0) {
      slowDown += (Math.fround(0.54600006) - slowDown) * eff
      speed += (attributeOf(entity, physics.movementSpeedAttribute, physics.playerSpeed) - speed) * eff
    }
    if (entity.dolphinsGrace > 0) slowDown = Math.fround(0.96)
    applyHeading(entity, strafe, forward, speed)
    moveEntity(entity, world, vel.x, vel.y, vel.z)
    if (entity.isCollidedHorizontally && isOnLadder(world, pos)) vel.y = 0.2
    vel.x *= slowDown
    vel.y *= Math.fround(0.8)
    vel.z *= slowDown
    const g = attributeOf(entity, 'minecraft:gravity', physics.gravity)
    if (!entity.control.sprint && g !== 0) {
      vel.y = (falling && Math.abs(vel.y - 0.005) >= 0.003 && Math.abs(vel.y - g / 16) < 0.003) ? -0.003 : vel.y - g / 16
    }
    if (entity.isCollidedHorizontally && doesNotCollide(world, pos.offset(vel.x, vel.y + 0.6 - pos.y + oldY, vel.z))) vel.y = 0.3
  }

  physics.simulatePlayer = (entity, world) => {
    const vel = entity.vel
    const pos = entity.pos

    const waterBB = modernMovementThreshold ? getPlayerBB(pos).contract(0.001, 0.001, 0.001) : getPlayerBB(pos).contract(0.001, 0.401, 0.001)
    const lavaBB = getPlayerBB(pos).contract(0.1, 0.4, 0.1)

    entity.isInWater = modernMovementThreshold ? modernWaterState(world, waterBB, vel, entity) : isInWaterApplyCurrent(world, waterBB, vel)
    // LocalPlayer.aiStep: shift in water sinks (goDownInWater) before LivingEntity.aiStep.
    if (modernMovementThreshold && entity.isInWater && entity.control.sneak) vel.y -= 0.04`,
      },
      {
        find: `      if (entity.isInWater || entity.isInLava) {
        vel.y += 0.04
      } else if (entity.onGround && entity.jumpTicks === 0) {`,
        replace: `      const liquidJump = modernMovementThreshold && entity.isInWater && !entity.isInLava
        ? (entity.waterHeight > 0 && (!entity.onGround || entity.waterHeight > 0.4))
        : (entity.isInWater || entity.isInLava)
      if (liquidJump) {
        vel.y += 0.04
      } else if (entity.onGround && entity.jumpTicks === 0) {`,
      },
      {
        find: `    if (entity.isInWater || entity.isInLava) {
      // Water / Lava movement`,
        replace: `    if (modernMovementThreshold && entity.isInWater) {
      modernTravelInWater(entity, world, strafe, forward)
    } else if (entity.isInWater || entity.isInLava) {
      // Water / Lava movement`,
      },
      {
        // The player hitbox is EntityDimensions.scalable(0.6F, 1.8F): float sizes, half width
        // 0.30000001192. With 0.3 the body could end 1.2e-8 inside a wall it walked into; Paper's
        // hasNewCollision (CLIPPED_INTO_BLOCK) then teleports it back every tick (seen swimming into
        // a pool wall). Floats only on 1.21.5+, where it was verified.
        find: `    playerHalfWidth: 0.3,
    playerHeight: 1.8,`,
        replace: `    playerHalfWidth: (mcData.version && typeof mcData.version['>='] === 'function' && mcData.version['>=']('1.21.5')) ? Math.fround(0.6) / 2 : 0.3,
    playerHeight: (mcData.version && typeof mcData.version['>='] === 'function' && mcData.version['>=']('1.21.5')) ? Math.fround(1.8) : 1.8,`,
      },
      {
        // 1.21.5+: LivingEntity.aiStep zeroes horizontal motion when its squared length is below 9e-6
        // (the old rule zeroed each axis below 0.003 separately).
        find: `    if (Math.abs(vel.x) < physics.negligeableVelocity) vel.x = 0
    if (Math.abs(vel.y) < physics.negligeableVelocity) vel.y = 0
    if (Math.abs(vel.z) < physics.negligeableVelocity) vel.z = 0`,
        replace: `    if (modernMovementThreshold) {
      if (vel.x * vel.x + vel.z * vel.z < 9.0E-6) { vel.x = 0; vel.z = 0 }
    } else {
      if (Math.abs(vel.x) < physics.negligeableVelocity) vel.x = 0
      if (Math.abs(vel.z) < physics.negligeableVelocity) vel.z = 0
    }
    if (Math.abs(vel.y) < physics.negligeableVelocity) vel.y = 0`,
      },
      {
        // 26.1 servers add sprint speed as modifier "minecraft:sprinting" (ids replaced UUIDs in
        // 1.21); the old UUID filter left it in place, so sprint speed counted twice. Work on a copy:
        // the entity's attribute object is the server's record.
        find: `          playerSpeedAttribute = entity.attributes[physics.movementSpeedAttribute]`,
        replace: `          playerSpeedAttribute = { value: entity.attributes[physics.movementSpeedAttribute].value, modifiers: (entity.attributes[physics.movementSpeedAttribute].modifiers || []).filter(m => m.uuid !== 'minecraft:sprinting' && m.id !== 'minecraft:sprinting') }`,
      },
      {
        find: `        vel.y = Math.fround(0.42) * ((blockBelow && blockBelow.type === honeyblockId) ? physics.honeyblockJumpSpeed : 1)`,
        replace: `        vel.y = attributeOf(entity, 'minecraft:jump_strength', Math.fround(0.42)) * ((blockBelow && blockBelow.type === honeyblockId) ? physics.honeyblockJumpSpeed : 1)`,
      },
      {
        find: `      strafe *= physics.sneakSpeed
      forward *= physics.sneakSpeed`,
        replace: `      strafe *= attributeOf(entity, 'minecraft:sneaking_speed', physics.sneakSpeed)
      forward *= attributeOf(entity, 'minecraft:sneaking_speed', physics.sneakSpeed)`,
      },
      {
        find: `        vel.y -= physics.gravity * gravityMultiplier
      }
      vel.y *= physics.airdrag`,
        replace: `        vel.y -= attributeOf(entity, 'minecraft:gravity', physics.gravity) * gravityMultiplier
      }
      vel.y *= physics.airdrag`,
      },
      {
        // Vanilla Player.maybeBackOffFromEdge / canFallAtLeast (26.1): a sneaking body on the ground
        // backs off an edge when the box below its feet (step height deep, deflated 1e-7) is empty.
        // prismarine tested any block in the cells around the body (feet level and up included), so a
        // wall, trunk or leaves beside a bridge disabled the clamp and the body walked off the edge
        // the server and Grim stop it at: setbacks while sneak-bridging.
        find: `    if (entity.control.sneak && entity.onGround) {
      const step = 0.05`,
        replace: `    if (modernMovementThreshold && entity.control.sneak && entity.onGround && !(dy > 0)) {
      const down = attributeOf(entity, 'minecraft:step_height', physics.stepHeight)
      const feet = getPlayerBB(pos)
      const canFall = (ox, oz) => {
        const q = new AABB(feet.minX + 1e-7 + ox, feet.minY - down - 1e-7, feet.minZ + 1e-7 + oz, feet.maxX - 1e-7 + ox, feet.minY, feet.maxZ - 1e-7 + oz)
        return !getSurroundingBBs(world, q).some((b) => b.intersects(q))
      }
      const sx = Math.sign(dx) * 0.05
      const sz = Math.sign(dz) * 0.05
      while (dx !== 0 && canFall(dx, 0)) { if (Math.abs(dx) <= 0.05) { dx = 0; break } dx -= sx }
      while (dz !== 0 && canFall(0, dz)) { if (Math.abs(dz) <= 0.05) { dz = 0; break } dz -= sz }
      while (dx !== 0 && dz !== 0 && canFall(dx, dz)) { dx = Math.abs(dx) <= 0.05 ? 0 : dx - sx; dz = Math.abs(dz) <= 0.05 ? 0 : dz - sz }
      oldVelX = dx
      oldVelZ = dz
    } else if (!modernMovementThreshold && entity.control.sneak && entity.onGround) {
      const step = 0.05`,
      },
      {
        find: `    if (physics.stepHeight > 0 &&`,
        replace: `    const stepHeight = attributeOf(entity, 'minecraft:step_height', physics.stepHeight)
    if (stepHeight > 0 &&`,
      },
      {
        find: `      dy = physics.stepHeight
`,
        replace: `      dy = stepHeight
`,
      },
      {
        // 26.1 Entity.collide step (as Grim's 1.21+ branch): step candidates are the shape tops between
        // the box after the downward collision and stepHeight above it, tried lowest first from that
        // box. prismarine kept the 1.8 step (up 0.6 from the pre-collision box, across, back down
        // 0.6), so falling next to a slightly higher partial block (snow layers, slabs, paths) landed
        // in mid-air on the old height: Grim Simulation .0515 offsets on layered snow.
        find: `    const stepHeight = attributeOf(entity, 'minecraft:step_height', physics.stepHeight)
    if (stepHeight > 0 &&`,
        replace: `    const stepHeight = attributeOf(entity, 'minecraft:step_height', physics.stepHeight)
    if (modernMovementThreshold && stepHeight > 0 &&
      (entity.onGround || (dy !== oldVelY && oldVelY < 0)) &&
      (dx !== oldVelX || dz !== oldVelZ)) {
      const collidedDown = dy !== oldVelY && oldVelY < 0
      const startBB = collidedDown ? oldBB.clone().offset(0, dy, 0) : oldBB.clone()
      const retrieval = startBB.clone().extend(oldVelX, stepHeight, oldVelZ)
      if (!collidedDown) retrieval.minY -= Math.fround(1e-5)
      const stepBBs = getSurroundingBBs(world, retrieval)
      const maxStep = Math.fround(stepHeight)
      const skip = Math.fround(dy)
      const heights = new Set()
      for (const bb of stepBBs) {
        for (const c of [bb.minY, bb.maxY]) {
          const rel = Math.fround(c - startBB.minY)
          if (!(rel < 0) && rel !== skip && rel <= maxStep) heights.add(rel)
        }
      }
      const horiz = dx * dx + dz * dz
      for (const h of [...heights].sort((a, b) => a - b)) {
        const box = startBB.clone()
        let sy = h
        for (const bb of stepBBs) sy = bb.computeOffsetY(box, sy)
        box.offset(0, sy, 0)
        let sx = oldVelX
        let sz = oldVelZ
        const zFirst = Math.abs(sx) < Math.abs(sz)
        if (zFirst) { for (const bb of stepBBs) sz = bb.computeOffsetZ(box, sz); box.offset(0, 0, sz) }
        for (const bb of stepBBs) sx = bb.computeOffsetX(box, sx)
        box.offset(sx, 0, 0)
        if (!zFirst) { for (const bb of stepBBs) sz = bb.computeOffsetZ(box, sz); box.offset(0, 0, sz) }
        if (sx * sx + sz * sz > horiz) {
          dx = sx
          dy = sy + (startBB.minY - oldBB.minY)
          dz = sz
          playerBB = box
          break
        }
      }
    } else if (!modernMovementThreshold && stepHeight > 0 &&`,
      },
    ],
  },
];

/** 对一个文件的源码套用补丁;原文缺失或不唯一时抛错。 */
function applySourcePatch(patch: SourcePatch, source: string): string {
  let out = source;
  for (const { find, replace } of patch.edits) {
    const at = out.indexOf(find);
    if (at < 0 || out.indexOf(find, at + 1) >= 0) {
      throw new Error(`${patch.pkg}/${patch.file} 的补丁原文${at < 0 ? '找不到' : '不唯一'},依赖版本与补丁不符:\n${find}`);
    }
    out = out.slice(0, at) + replace + out.slice(at + find.length);
  }
  return out;
}

function patchFor(filename: string): SourcePatch | undefined {
  const path = filename.replaceAll('\\', '/');
  return PATCHES.find((p) => path.endsWith(`/node_modules/${p.pkg}/${p.file}`));
}

type Compile = (this: unknown, content: string, filename: string, ...rest: unknown[]) => unknown;

const FLAG = Symbol.for('cortico.minecraft.dependencyPatches');

/** 重复调用无效。 */
function installDependencyPatches(): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (g[FLAG]) return;
  g[FLAG] = true;
  const proto = Module.prototype as unknown as { _compile: Compile };
  const compile = proto._compile;
  proto._compile = function (this: unknown, content: string, filename: string, ...rest: unknown[]): unknown {
    const patch = patchFor(filename);
    return compile.call(this, patch ? applySourcePatch(patch, content) : content, filename, ...rest);
  };
}

installDependencyPatches();
