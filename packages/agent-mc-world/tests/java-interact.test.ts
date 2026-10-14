import {expect,it} from 'vitest';
import {nativeInteractInput,nativeInteractProgram} from '../src/client/java-interact.ts';
it('selects bounded data for one fixed interaction without interpolating caller text into code',()=>{
  expect(nativeInteractInput({target:[-1,65,-2],action:'use',holdMs:150,observePositions:[[-1,66,-2]]})).toEqual({position:[-1,65,-2],action:'use',hold:.15,max_distance:4.5,aim_offset:[.5,.5,.5],observe_positions:[[-1,66,-2]]});
  for(const args of [{target:[1.5,65,2]},{target:[1,65,2],action:'move'},{target:[1,65,2],holdMs:2001},{target:[1,65,2],maxDistance:NaN},{target:[1,65,2],aimOffset:[0,2,0]}])expect(()=>nativeInteractInput(args)).toThrow();
});
it('loads only the owned packaged program and keeps its selected data separate',()=>{
  const code=nativeInteractProgram();expect(code).toContain('def interact_block(');expect(code).toContain('player_get_targeted_block');
  expect(code.endsWith('\nresult = interact_block(**input_data)\n')).toBe(true);
  expect(code).not.toContain('Cortico');expect(code).not.toContain('requests.');
});
