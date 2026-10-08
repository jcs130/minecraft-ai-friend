'use strict'
const { attachMenuClient } = require('./menu-client.cjs')
const { attachWorldClient } = require('./world-client.cjs')
const { attachMaidClient } = require('./maid-client.cjs')
const { attachColonyClient } = require('./colony-client.cjs')
const { attachSpellClient } = require('./spell-client.cjs')
const { attachDomumClient } = require('./domum-client.cjs')
const { attachCollisionClient } = require('./collision-client.cjs')
const { attachNativeWorldQuery } = require('../society-agent/native-world-query.cjs')
const { agentToolCatalog } = require('../society-agent/tool-catalog.cjs')
const { attachModOperationsClient } = require('./mod-operations-client.cjs')
const { attachModCallClient } = require('./mod-call-client.cjs')

// Framework-neutral adapters on ONE ordinary player's existing connection.
// A local API catalog is not proof that a remote bridge or every mod is ready.
function attachModAgentClient (bot) {
  if (!bot?._client || typeof bot._client.on !== 'function' || typeof bot._client.write !== 'function' ||
      typeof bot.on !== 'function' || typeof bot.off !== 'function') throw Error('MOD_AGENT_CONNECTION_INVALID')
  const clients = { menu: attachMenuClient(bot), world: attachWorldClient(bot),
    native: attachNativeWorldQuery(bot), maid: attachMaidClient(bot),
    colony: attachColonyClient(bot), spell: attachSpellClient(bot),
    domum: attachDomumClient(bot), collision: attachCollisionClient(bot), mods: attachModOperationsClient(bot) }
  clients.world.interact = clients.mods.world.interact
  let closed = false
  const calls = attachModCallClient(bot, clients, () => closed)
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  function detach () {
    if (closed) return
    closed = true
    bot.off('end', detach)
    calls.detach()
    for (const client of Object.values(clients)) client.detach()
  }
  bot.on('end', detach)
  return {
    ...clients,
    create: clients.mods.create,
    curios: clients.mods.curios,
    call: calls.call,
    operations: calls.operations,
    callStatus: calls.callStatus,
    tools: id => agentToolCatalog(id),
    contract () {
      return { schemaVersion: 1, source: 'installed_client_adapters',
        playerUuid: !closed && uuidPattern.test(bot._client.uuid || '') ? bot._client.uuid.toLowerCase() : null,
        closed, connectionSource: 'existing_player_connection',
        catalogScope: 'maw_agent_executor_descriptors', planExecutionAvailable: false,
        directCallAvailable: true, directCallScope: 'native_client_operations',
        directOperationCount: calls.operations().operationCount,
        channels: ['maw_agent:menu_action', 'maw_agent:menu_state',
          'maw_agent:world_query', 'maw_agent:world_state',
          'maw_agent:maid_query', 'maw_agent:maid_action', 'maw_agent:maid_state',
          'maw_agent:colony_query', 'maw_agent:colony_action', 'maw_agent:colony_state',
          'maw_agent:spell_query', 'maw_agent:spell_action', 'maw_agent:spell_state',
          'maw_agent:domum_query', 'maw_agent:domum_action', 'maw_agent:domum_state',
          'maw_agent:mod_query', 'maw_agent:mod_action', 'maw_agent:mod_state'],
        allModsVerified: false, publicAccessReady: false,
        limits: ['requires_server_bridge_and_gateway', 'native_identity_and_complete_components',
          'server_permissions_still_apply', 'unknown_mutations_must_not_be_retried',
          'in_memory_receipts_are_not_cross_restart_exactly_once'] }
    },
    detach
  }
}
module.exports = { attachModAgentClient }
