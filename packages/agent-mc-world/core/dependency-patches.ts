/**
 * mineflayer-pathfinder 2.4.5、prismarine-windows 2.10.0 与 mineflayer 4.37.1 的源码补丁:包一层 CommonJS 的
 * `Module.prototype._compile`,编译前改写源码。要改的状态或监听器在闭包里,运行时替换函数够不着。
 * 补丁随 World 的源码走:World 作为扩展装进别的实例时,宿主的 pnpm 不会替它打包补丁。
 *
 * 引擎子进程以 `--import` 加载本模块;测试先 import 本模块再加载依赖。
 * 每处改写的原文必须在文件里恰好出现一次,依赖升级后对不上时加载即抛错。
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
    pkg: 'mineflayer',
    file: 'lib/plugins/entities.js',
    edits: [{
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
    }, {
      find: `  // dismounting when the vehicle is gone
  bot._client.on('entityGone', (entity) => {`,
      replace: `  // entity_destroy emits entityGone on Bot, not its protocol Client.
  bot.on('entityGone', (entity) => {`,
    }],
  },
  {
    pkg: 'mineflayer',
    file: 'lib/plugins/physics.js',
    edits: [
      {
        find: `  let shouldUsePhysics = false`,
        replace: `  let shouldUsePhysics = false
  let hasCurrentPosition = false`,
      },
      {
        find: `        shouldUsePhysics = true
        bot.jumpTicks = 0`,
        replace: `        // A delayed respawn position can arrive after set_passengers.
        // Confirm the packet, but do not simulate walking for a mounted rider.
        hasCurrentPosition = true
        shouldUsePhysics = !bot.vehicle
        bot.jumpTicks = 0`,
      },
      {
        find: `    shouldUsePhysics = true
    bot.jumpTicks = 0`,
        replace: `    // Position acknowledgement does not revoke the server's vehicle attachment.
    hasCurrentPosition = true
    shouldUsePhysics = !bot.vehicle
    bot.jumpTicks = 0`,
      },
      {
        find: `  bot.on('mount', () => { shouldUsePhysics = false })
  bot.on('death', () => {
    shouldUsePhysics = false`,
        replace: `  bot.on('mount', () => { shouldUsePhysics = false })
  bot.on('dismount', () => {
    // A native detach or destroyed vehicle returns control to walking. It
    // does not supply a missing post-login/respawn/configuration position.
    shouldUsePhysics = hasCurrentPosition && !bot.vehicle && bot.health > 0
  })
  bot._client.on('state', (state) => {
    if (state === 'configuration') { hasCurrentPosition = false; shouldUsePhysics = false }
  })
  bot.on('death', () => {
    hasCurrentPosition = false
    shouldUsePhysics = false`,
      },
      {
        find: `  bot.on('respawn', () => { shouldUsePhysics = false })
  bot.on('login', () => {
    shouldUsePhysics = false`,
        replace: `  bot.on('respawn', () => { hasCurrentPosition = false; shouldUsePhysics = false })
  bot.on('login', () => {
    hasCurrentPosition = false
    shouldUsePhysics = false`,
      },
    ],
  },
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
