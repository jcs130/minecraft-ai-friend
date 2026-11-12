import { describe, expect, it } from 'vitest';
import { executionFactParts, executionFeedbackContext, hasExecutionFeedbackContext } from '../src/context.ts';
import { methodHarness } from './method-harness.ts';

describe('source-owned execution context', () => {
  it('binds server feedback to the original text without establishing an action result', () => {
    const text = 'Directory entry: fixture_site';
    const marker = executionFeedbackContext(text);
    expect(hasExecutionFeedbackContext(text, marker)).toBe(true);
    expect(hasExecutionFeedbackContext(`${text} changed`, marker)).toBe(false);
    expect(hasExecutionFeedbackContext(text, { ...marker, protocol: 'other' })).toBe(false);
    expect(hasExecutionFeedbackContext(text, null)).toBe(false);
    expect(marker).not.toHaveProperty('taskId');
    expect(marker).not.toHaveProperty('completed');
  });

  it('includes producer-required current state for a body owner while preserving optional focus and semantic digests', () => {
    const current = {
      executionPartKeys: ['queue', 'lastTask'],
      parts: [
        { key: 'place', text: 'Current location' },
        { key: 'queue', text: 'Task 19 running', stateRevision: `sha256:${'a'.repeat(64)}` },
        { key: 'lastTask', text: 'Task 18 failed at 12:00' },
        { key: 'farm', text: 'Unrelated farm details' },
      ],
    };
    const parts = executionFactParts(current, ['place'], true);
    expect(parts.map(part => part.key)).toEqual(['place', 'queue', 'lastTask']);
    expect(parts[1]).toEqual(current.parts[1]);
    expect(executionFactParts(current, ['place'], false).map(part => part.key)).toEqual(['place']);
    expect(parts).not.toContainEqual(current.parts[3]);
    expect(executionFactParts({ executionPartKeys: ['queue'], parts: [] }, ['place'], true))
      .toEqual([{ key: 'place', text: '[当前分区不可用；旧值不作现场]' }, { key: 'queue', text: '[当前分区不可用；旧值不作现场]' }]);
    expect(executionFactParts({ parts: current.parts }, ['place'], true)).toEqual([current.parts[0]]);
  });

  it('delivers the water travel option to a narrowly scoped body owner and drops it after leaving water', () => {
    const rig = methodHarness('1.21.1');
    try {
      rig.set(0,64,0,'water');
      const facts=rig.world.requestFacts()!;
      expect(facts.partKeys).toContain('travelOptions');
      expect(facts.executionPartKeys).toContain('travelOptions');
      const ownerFacts=executionFactParts(facts,['body','gear','sample'],true);
      const option=ownerFacts.find(part=>part.key==='travelOptions')!.text;
      expect(option).toContain('mc_options {"intent":"water"}');
      expect(option).toContain('当前位置触水');
      expect(option.length).toBeLessThan(500);
      expect(option).toContain('已同步随身候选木料');
      expect(option).toContain('goto 只步行/游泳');
      expect(ownerFacts.some(part=>part.key==='options')).toBe(false);
      expect(executionFactParts(facts,['body'],false).some(part=>part.key==='travelOptions')).toBe(false);
      expect(facts.options?.options.find(choice=>choice.id==='core.boat')?.read)
        .toContainEqual({tool:'mc_knowledge',args:{kind:'recipe',query:'boat'}});
      rig.set(0,64,0,'air');
      const ashore=rig.world.requestFacts()!;
      expect(ashore.executionPartKeys).not.toContain('travelOptions');
      expect(ashore.parts?.some(part=>part.key==='travelOptions')).toBe(false);
    } finally { rig.close(); }
  });

  it('marks native server packets and excludes player chat, whispers and login messages', async () => {
    const rig = methodHarness('1.21.1');
    try {
      (rig.world as any).hookMessageEvents(rig.bot);
      rig.bot.emit('message', { toString: () => 'Login message' }, 'system', null);
      (rig.world as any).hookedBots.add(rig.bot);
      rig.bot.emit('message', { toString: () => 'Directory entry: fixture_site' }, 'system', null);
      rig.bot.emit('message', { toString: () => 'Player quote: Directory entry' }, 'system', '12345678-1234-1234-1234-123456789012');
      rig.bot.emit('message', { toString: () => 'Public player words' }, 'chat', '12345678-1234-1234-1234-123456789012');
      rig.bot.emit('message', { translate: 'commands.message.display.incoming', toString: () => 'Private player words' }, 'system', null);
      await Promise.resolve();
      await Promise.resolve();
      const native = rig.host.events.find(row => row.text.includes('Directory entry: fixture_site'))!;
      expect(hasExecutionFeedbackContext(native.text, native.meta?.executionFeedback)).toBe(true);
      for (const row of rig.host.events.filter(row => row !== native))
        expect(row.meta?.executionFeedback).toBeUndefined();
      const facts = rig.world.requestFacts()!;
      expect(facts.executionPartKeys).toContain('queue');
      expect(facts.executionPartKeys).toContain('lastTask');
    } finally {
      rig.close();
    }
  });
});
