import {expect,it} from 'vitest';
import {taskSceneQuery} from '../src/context.ts';
it('retains task purpose and a late correction after a long inventory preamble',()=>{
  const directive='库存观察：'+ '旧位置和物品。'.repeat(80)+'当前改用移动技能查找安全落点';
  const result=taskSceneQuery({purpose:'离开受保护洞穴',directive});
  expect(result.length).toBeLessThanOrEqual(200);
  expect(result).toContain('离开受保护洞穴');expect(result).toContain('当前改用移动技能查找安全落点');
  expect(result).toContain('…');expect(directive).toContain('旧位置和物品。'.repeat(80));
});
it('keeps explicitly model-selected terms instead of guessing categories or spells',()=>{
  expect(taskSceneQuery({purpose:'old',directive:'old',query:'跳跃 净空 支撑'})).toBe('跳跃 净空 支撑');
  expect(taskSceneQuery({directive:'same',purpose:'same'})).toBe('same');
  expect(taskSceneQuery({})).toBe('');expect(()=>taskSceneQuery({},0)).toThrow();
});
