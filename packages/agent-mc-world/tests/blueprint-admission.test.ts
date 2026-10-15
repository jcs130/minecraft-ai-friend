import { describe, expect, it } from 'vitest';
import { parseBlueprintArgs, MINECRAFT_TOOL_DECLS } from '../core/world.ts';
import { readSkillHelp } from '../core/skills.ts';

describe('blueprint operation admission', () => {
  it('rejects hallucinated operation envelopes instead of silently listing empty blueprints', () => {
    for (const args of [{action:'design'}, {op:'save',key:'shelter'}, {help:true}, {save:{key:'shelter'},action:'save'}]) {
      const result = parseBlueprintArgs(args);
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('{save:');
    }
  });
  it('retains exact empty reads and publishes strict top-level schema', () => {
    expect(parseBlueprintArgs({})).toEqual({kind:'query'});
    expect(parseBlueprintArgs({unload:'shelter'})).toEqual({kind:'unload',key:'shelter'});
    expect(MINECRAFT_TOOL_DECLS.find(tool=>tool.name==='mc_blueprint')?.parameters.additionalProperties).toBe(false);
  });
  it('describes actual craft count units and does not advertise a hidden design model',()=>{
    const help=readSkillHelp({skill:'craft'});
    expect('text' in help && help.text).toContain('count 是本次要新增的产物个数');
    expect('text' in help && help.text).toContain('grid 模式的 count 是重复配方次数');
    const schema=MINECRAFT_TOOL_DECLS.find(tool=>tool.name==='mc_blueprint')?.parameters;
    expect(schema?.description).not.toContain('交给后台去构思');
  });
});
