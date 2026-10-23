import {expect,it} from 'vitest';
import {clientAppearanceTarget} from '../scripts/client-appearance-targets.mjs';

it('reads the BOM in the original Fabric 2.6.5 artifact and retains its exact dependency version',()=>{
  expect(clientAppearanceTarget('\uFEFF'+JSON.stringify({id:'yes_steve_model',version:'2.6.5-fabric+mc1.21.1'})))
    .toEqual({version:'2.6.5',declaredVersion:'2.6.5-fabric+mc1.21.1'});
});
it('retains the verified legacy adapter',()=>{
  expect(clientAppearanceTarget(JSON.stringify({id:'yes_steve_model',version:'2.4.1'})))
    .toEqual({version:'2.4.1',declaredVersion:'2.4.1'});
});
it.each([
  {id:'another-mod',version:'2.4.1'},
  {id:'yes_steve_model',version:'2.7.0'},
  {id:'yes_steve_model',version:'2.6.5'},
  {id:'yes_steve_model',version:'2.6.5-forge+mc1.20.1'},
  {id:'yes_steve_model'},
])('rejects an unverified identity, platform or version: %j',metadata=>{
  expect(()=>clientAppearanceTarget(JSON.stringify(metadata))).toThrow('Unverified YSM dependency');
});
