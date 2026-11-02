import { expect, it } from 'vitest';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import { omitContextSchemaAnnotations, preserveToolInputSignatures } from '../src/context.ts';
import { compactToolSchema } from '../src/client/context-budget.ts';
import { withToolHelp } from '../src/client/tool-help.ts';
import { MINECRAFT_TOOL_DECLS } from '../core/world.ts';
import { nullLogger } from '../src/client/index.ts';
import { SKILL_STEP_SCHEMA } from '../core/skills.ts';

type Schema = Parameters<AjvJsonSchemaValidator['getValidator']>[0];
const validator = (schema: unknown) => new AjvJsonSchemaValidator().getValidator(schema as Schema);
const annotation='x-agent-mc-skill-contracts';

it('retains per-skill field relationships when host prose compaction removed the long directory', () => {
  // Captured host projection: it keeps the flat properties and their validators,
  // but abbreviates the steps prose before removing the generation annotation.
  const input=structuredClone(SKILL_STEP_SCHEMA);
  input.description='A short heading; read full help for more.';
  const original=structuredClone(input);
  const result=preserveToolInputSignatures(input,omitContextSchemaAnnotations(input) as Record<string,unknown>);
  const fields=result.properties as Record<string,Record<string,unknown>>;
  expect(fields.skill.description).toContain('look(at*)');
  expect(fields.skill.description).toContain('harvest(block*,at*');
  expect(fields.skill.description).toContain('observe(mode="sites"*,sites*)');
  expect(fields.skill.description).toContain('entityId?');
  expect(result.required).toEqual(input.required);
  expect(result.oneOf).toBeUndefined();
  expect(input).toEqual(original);
  expect(preserveToolInputSignatures(input,result)).toBe(result);
});

it('ignores malformed generation metadata and does not treat argument literals as schemas', () => {
  const input={type:'object',properties:{skill:{type:'string',enum:['look']}},
    [annotation]:{look:[{type:'object',properties:{skill:{const:'other'},at:{}},required:['skill','at']}]}};
  expect(preserveToolInputSignatures(input,omitContextSchemaAnnotations(input) as Record<string,unknown>)).toEqual({type:'object',properties:input.properties});
  const literal={type:'object',const:{[annotation]:SKILL_STEP_SCHEMA[annotation]}};
  expect(preserveToolInputSignatures(literal,literal)).toBe(literal);
});

it('recovers the small field index from a deferred native schema without restoring the full generation directory', () => {
  const declaration=MINECRAFT_TOOL_DECLS.find(tool=>tool.name==='mc_do')!;
  const mounted=withToolHelp([{...declaration,handler:async()=>{throw Error('No action permitted');}}],'help',{parameterDescriptions:'on-demand'})[0];
  const abbreviated=structuredClone(mounted.parameters);
  const view=preserveToolInputSignatures(mounted.parameters,abbreviated);
  const items=(view.properties as any).steps.items;
  expect(items.properties.skill.description).toContain('look(at*)');
  expect(items.properties.skill.description).toContain('harvest(block*,at*');
  expect(JSON.stringify(view)).not.toContain(annotation);
  expect(JSON.stringify(view).length).toBeLessThan(JSON.stringify(declaration.parameters).length/2);
  const before=validator(mounted.parameters),after=validator(view);
  for(const args of [{steps:[{skill:'look'}]},{steps:[{skill:'look',at:[1,64,2]}]},
    {steps:[{skill:'harvest',block:'wheat',at:[1,64,2]}]}]) expect(after(args).valid).toBe(before(args).valid);
  expect((mounted.parameters.properties as any).steps.items.properties.skill.description).toBeUndefined();
});

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
