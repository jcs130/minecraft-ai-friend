import {expect,it} from 'vitest';
import {nativeProbeInput,NATIVE_PROBE_PROGRAM} from '../src/client/java-probe.ts';
it('bounds the observed volume before the native executor and preserves absolute integer samples',()=>{
  expect(nativeProbeInput({})).toMatchObject({radius:3,below:1,above:2,limit:12,names:[]});
  expect(nativeProbeInput({positions:[[-1,65,-2]],names:['minecraft:carrots']})).toMatchObject({positions:[[-1,65,-2]],names:['minecraft:carrots']});
  for(const args of [{radius:7},{limit:0},{names:['carrots']},{positions:[[1.5,65,0]]},{positions:[[0,65,0]],radius:1},{positions:Array(513).fill([0,65,0])}])expect(()=>nativeProbeInput(args)).toThrow();
  expect(NATIVE_PROBE_PROGRAM).toContain('math.floor');expect(NATIVE_PROBE_PROGRAM).toContain('getblocklist');
});
