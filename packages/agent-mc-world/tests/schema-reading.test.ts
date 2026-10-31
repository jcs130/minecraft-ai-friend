import { expect, it } from 'vitest';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import { omitContextSchemaAnnotations } from '../src/context.ts';
import { compactToolSchema } from '../src/client/context-budget.ts';
import { withToolHelp } from '../src/client/tool-help.ts';
import { MINECRAFT_TOOL_DECLS } from '../core/world.ts';
import { nullLogger } from '../src/client/index.ts';

type Schema = Parameters<AjvJsonSchemaValidator['getValidator']>[0];
const validator = (schema: unknown) => new AjvJsonSchemaValidator().getValidator(schema as Schema);
const annotation='x-agent-mc-skill-contracts';

it('removes the generation directory from the request while preserving real action-schema validation', () => {
  const original=MINECRAFT_TOOL_DECLS.find(tool=>tool.name==='mc_do')!.parameters, saved=structuredClone(original);
  const compact=omitContextSchemaAnnotations(original),before=validator(original),after=validator(compact);
  expect(JSON.stringify(original)).toContain(annotation);expect(JSON.stringify(compact)).not.toContain(annotation);
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(original).length);
  for(const skill of ['use','goto','observe','build','chat','invented']) for(const at of [[1,64],[1,64,2],'unknown',null]) {
    const call={steps:[{skill,at,entityId:'invalid',index:-1,open:'true'}]};
    expect(after(call).valid).toBe(before(call).valid);
  }
  const valid={steps:[{skill:'chat',text:'Hello'}]};expect(before(valid).valid).toBe(true);expect(after(valid).valid).toBe(true);
  expect(original).toEqual(saved);
});

it('uses the same view in compact catalogues and retains the complete source behind full help', async () => {
  const declaration=MINECRAFT_TOOL_DECLS.find(tool=>tool.name==='mc_do')!,tool={...declaration,handler:async()=>{throw Error('No action permitted');}};
  const tools=withToolHelp([tool],'help',{parameterDescriptions:'on-demand'});
  expect(JSON.stringify(tools[0].parameters)).not.toContain(annotation);
  expect(JSON.stringify(compactToolSchema(tool,tool.parameters).schema)).not.toContain(annotation);
  const full=await tools.find(tool=>tool.name==='help')!.handler({name:'mc_do',path:'/properties/steps/items',full:true},{role:'main',log:nullLogger()});
  expect(JSON.stringify(full)).toContain(annotation);
  expect(JSON.stringify(declaration.parameters)).toContain(annotation);
});

it('keeps identically named argument properties and literal data intact', () => {
  const schema={type:'object',properties:{[annotation]:{type:'string'},literal:{const:{[annotation]:'literal'}}},
    default:{[annotation]:'data'},enum:[{[annotation]:'data'}],examples:[{[annotation]:'data'}],
    allOf:[{[annotation]:{directory:'not required in the request'},required:[annotation]}]};
  const view=omitContextSchemaAnnotations(schema) as typeof schema;
  expect(view.properties).toEqual(schema.properties);expect(view.default).toEqual(schema.default);
  expect(view.enum).toEqual(schema.enum);expect(view.examples).toEqual(schema.examples);
  expect(view.allOf).toEqual([{required:[annotation]}]);
  const untouched={type:'number',minimum:0,maximum:3};expect(omitContextSchemaAnnotations(untouched)).toBe(untouched);
});

it('full and compact action catalogues reject malformed dependency indices while accepting independent help', () => {
  const tool=MINECRAFT_TOOL_DECLS.find(tool=>tool.name==='mc_do')!;
  for(const schema of [tool.parameters,compactToolSchema(tool,tool.parameters).schema]) {
    const validate=validator(schema);
    for(const needs of [[],[1]]) {
      expect(validate({steps:[{skill:'pickup',item:'bread'},{skill:'chat',text:'fixture',needs}]}).valid).toBe(true);
    }
    for(const needs of [[0],[-1],[1.5],['1'],'1']) {
      expect(validate({steps:[{skill:'chat',text:'fixture',needs}]}).valid,JSON.stringify(needs)).toBe(false);
    }
  }
});

it('collapsed array fields retain scalar item bounds, literal constraints and uniqueness without prose', () => {
  const fields={
    ids:{type:'array',uniqueItems:true,items:{type:'integer',minimum:1,maximum:9,multipleOf:2,description:'long note'}},
    names:{type:'array',items:{type:'string',minLength:2,maxLength:4,pattern:'^[a-z]+$',description:'long note'}},
    ratios:{type:'array',items:{type:'number',exclusiveMinimum:0,exclusiveMaximum:1}},
    flags:{type:'array',items:{type:['boolean','null'],const:true}},
  };
  const schema={type:'object',properties:{steps:{type:'array',items:{type:'object',properties:fields}}}};
  const compact=compactToolSchema({name:'fixture'},schema,{collapseProperties:1}).schema as any;
  expect(compact.properties.steps.items.properties.ids.items).toEqual({type:'integer',minimum:1,maximum:9,multipleOf:2});
  const full=validator(schema),slim=validator(compact);
  for(const fields of [{ids:[2,4],names:['ab'],ratios:[.5],flags:[true]},
    {ids:[0]},{ids:[10]},{ids:[3]},{ids:[2,2]},{names:['a']},{names:['abcde']},{names:['AB']},
    {ratios:[0]},{ratios:[1]},{flags:[false]}]) {
    const input={steps:[fields]}; expect(slim(input).valid).toBe(full(input).valid);
  }
});
