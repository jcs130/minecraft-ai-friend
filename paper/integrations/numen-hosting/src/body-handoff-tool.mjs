import { createHash } from 'node:crypto';
import { fail } from './protocol.mjs';

export function bodyHandoffTool({ handoff, controller, authority, assertDriver }) {
  const characterId = controller.characterId;
  return {
    name: 'mc_character_body',
    description: '查看本角色可切换的身体和原角色账簿。只有已获授权、场景适合时才选择目标。结果未确定时按原请求查询，切换受理后结束当前回合。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { enum: ['current', 'assets', 'switch', 'lookup'] },
        targetKind: { enum: ['mineflayer', 'numen', 'maid', 'villager'] },
        requestId: { type: 'string', description: '查询时使用之前收到的换身请求编号' },
      },
    },
    tags: ['flow', 'write'],
    bodyControl: 'independent',
    readOnlyCall: args => ['current', 'assets', 'lookup'].includes(args.action),
    async handler(args, { callId, signal }) {
      signal?.throwIfAborted();
      if (args.action === 'current') return { text: '角色身体状态', data: handoff.current(characterId, authority) };
      if (args.action === 'assets') {
        assertDriver();
        handoff.assertControl(controller, authority);
        return { text: '原玩家账簿', data: await handoff.assets(characterId, authority) };
      }
      if (args.action === 'lookup') {
        return { text: '原换身请求回执', data: await handoff.reconcile({ characterId, requestId: args.requestId }, authority) };
      }
      if (args.action !== 'switch' || typeof callId !== 'string' || !callId) {
        throw fail('BODY_HANDOFF_INVALID_REQUEST', '需要带稳定调用编号的换身请求。', 400);
      }
      assertDriver();
      const requestId = 'turn-' + createHash('sha256').update(callId).digest('hex');
      const data = handoff.controllerSwitch({
        characterId, requestId, targetKind: args.targetKind, expectedGeneration: controller.generation,
      }, controller, authority);
      return { text: '换身请求已登记，查询原请求确认结果。', data, endsTurn: true };
    },
  };
}
