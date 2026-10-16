/** Shared Mineflayer-shaped program contract. A body may expose only a subset. */
export const BOT_METHODS = [
  'read', 'blockAt', 'findBlocks', 'findBlock', 'canSeeBlock', 'canDigBlock', 'digTime',
  'inventory.items', 'getControlState', 'setQuickBarSlot', 'look', 'lookAt',
  'setControlState', 'clearControlStates', 'waitForTicks', 'pathfinder.goto',
  'dig', 'stopDigging', 'placeBlock', 'equip', 'unequip',
  'activateBlock', 'activateItem', 'deactivateItem',
] as const;
export type BotMethod = typeof BOT_METHODS[number];

/** Allowlisted metadata only: no raw bridge response, instance identity or lease. */
export function methodCapabilities(backend: 'mineflayer' | 'java-client', advertised: readonly unknown[]) {
  const supported = new Set(advertised.filter((name): name is string => typeof name === 'string'));
  return {
    schema: 'minecraft-method-capabilities/v1' as const,
    contract: 'minecraft-method/v1' as const,
    backend,
    botMethods: BOT_METHODS.filter(name => supported.has(name)),
    mcMethods: ['capabilities', 'state', 'do', ...(backend === 'mineflayer' ? ['flightPlan'] : [])],
    stepGroups: backend === 'mineflayer' ? 'core' : 'single-legacy',
    pluginLoading: false,
  };
}

export const METHOD_CAPABILITIES_HELP = 'await mc.capabilities(): shared minecraft-method-capabilities/v1 metadata with backend, botMethods, mcMethods, stepGroups and pluginLoading:false. '
  + 'botMethods contains only methods supported by this body at program start, in stable common order; it does not imply identical reach, visibility, block fields or navigation constraints. '
  + 'Use the same Mineflayer-shaped bot/Vec3 program on either backend and check required methods before its first body call. '
  + 'Missing methods are unavailable, never successful no-ops. Capability reads do not claim control, reserve the body, execute a skill, or load arbitrary Mineflayer plugins. '
  + 'Read the focused method help for backend-specific bounds. All bot calls still require await; direct synchronous bot.entity and arbitrary plugins/events are outside this worker contract.';
