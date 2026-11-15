import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { installMiningLimiter, MINING_LIMIT_DEFAULTS } from '../core/mining-limiter.ts';
import { installMovementPace, MOVEMENT_PACE_DEFAULTS } from '../core/movement-pace.ts';

const warning = '[反作弊] 检测到你疑似在使用自动化模组，继续使用将被临时封禁';
const player = '00000000-0000-4000-8000-000000000123';

function fixture(enabled = true) {
  const bot = Object.assign(new EventEmitter(), {
    dig: async () => {}, look: async () => {},
    entity: { yaw: 0, pitch: 0, position: { x: 0, y: 64, z: 0 } },
    clearControlStates() {},
    pathfinder: { goal: 1 as unknown, setGoal(g: unknown) { this.goal = g; }, isMoving: () => false },
  });
  const mining = installMiningLimiter(bot, () => ({ ...MINING_LIMIT_DEFAULTS, enabled }));
  const movement = installMovementPace(bot, () => ({ ...MOVEMENT_PACE_DEFAULTS, enabled: true }));
  return { bot, mining, movement };
}

describe('server warning source boundary', () => {
  it.each([
    ['ordinary player chat', '<AnotherPlayer> 你知道服务器反作弊怎么判断吗？', 'chat', {}, player],
    ['quoted warning', warning, 'chat', {}, player],
    ['sender on a system line', warning, 'system', {}, player],
    ['unknown transport', warning, undefined, undefined, undefined],
    ['public native translation', warning, 'system', { translate: 'chat.type.text' }, undefined],
    ['native whisper', warning, 'system', { json: { translate: 'commands.message.display.incoming' } }, undefined],
    ['actionbar', warning, 'game_info', {}, undefined],
    ['unsigned player decoration', warning, 'system', { unsigned: { text: warning } }, undefined],
    ['plugin chat quote', '<AnotherPlayer> ' + warning, 'system', {}, undefined],
  ])('ignores %s', (_label, text, position, message, sender) => {
    const { bot, mining, movement } = fixture();
    bot.emit('messagestr', text, position, message, sender);
    expect(mining.hardStopped).toBe(false);
    expect(movement.hardStopped).toBe(false);
    expect(bot.pathfinder.goal).toBe(1);
  });

  it.each([undefined, null, '00000000-0000-0000-0000-000000000000'])('honors a server system warning with sender %s', sender => {
    const { bot, mining, movement } = fixture();
    bot.emit('messagestr', warning, 'system', { json: { text: warning } }, sender);
    expect(mining.hardStopped).toBe(true);
    expect(movement.hardStopped).toBe(true);
    expect(bot.pathfinder.goal).toBeNull();
  });

  it('does not emit a movement stop from disabled mining warnings', () => {
    const { bot, mining, movement } = fixture(false);
    bot.emit('messagestr', warning, 'system', { json: { text: warning } });
    expect(mining.hardStopped).toBe(false);
    expect(movement.hardStopped).toBe(false);
  });
});
