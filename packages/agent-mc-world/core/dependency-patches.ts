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
  /** Exact reviewed upstream forms; a missing or ambiguous form still fails. */
  alternatives?: readonly { find: string; replace: string }[];
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
    file: 'index.js',
    edits: [
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
        alternatives: [{
          find: `    if ((packet.reason === 4 || packet.reason === 'win_game') && packet.gameMode === 1) {
      bot._client.write('client_command', { actionId: 'perform_respawn' })
    }`,
          replace: `    // Current upstream uses a named protocol mapper for this action.
    // Acknowledge both first credits and subsequent End exits.
    if (packet.reason === 4 || packet.reason === 'win_game') {
      bot._client.write('client_command', { actionId: 'perform_respawn' })
    }`,
        }],
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
  for (const edit of patch.edits) {
    const candidates = [edit, ...(edit.alternatives ?? [])];
    const matches = candidates.map(candidate => ({ ...candidate, at: out.indexOf(candidate.find) }))
      .filter(candidate => candidate.at >= 0);
    if (matches.length !== 1 || matches.some(candidate => out.indexOf(candidate.find, candidate.at + 1) >= 0)) {
      throw new Error(`${patch.pkg}/${patch.file} 的补丁原文${matches.length === 0 ? '找不到' : '不唯一'},依赖版本与补丁不符:\n${edit.find}`);
    }
    const {find, replace, at} = matches[0]!;
    out = out.slice(0, at) + replace + out.slice(at + find.length);
  }
  return out;
}

function patchFor(filename: string): SourcePatch | undefined {
  const path = filename.replaceAll('\\', '/');
  return PATCHES.find((p) => path.endsWith(`/node_modules/${p.pkg}/${p.file}`));
}

/** Pure source validation, shared by the loader and compatibility regression tests. */
export function applyDependencySourcePatch(filename: string, source: string): string {
  const patch = patchFor(filename);
  return patch ? applySourcePatch(patch, source) : source;
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
    return compile.call(this, applyDependencySourcePatch(filename, content), filename, ...rest);
  };
}

installDependencyPatches();
