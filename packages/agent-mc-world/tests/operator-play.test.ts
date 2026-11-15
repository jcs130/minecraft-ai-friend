import {describe,it,expect} from 'vitest';
import {operatorPlaySteps} from '../src/client/operator-play.ts';
describe('bounded local operator play',()=>{
 it('only sends the fixed read-only menu command',()=>{expect(operatorPlaySteps('play.menu',{})).toEqual([{skill:'chat',text:'/menu'}]); expect(()=>operatorPlaySteps('play.menu',{text:'/rtp'})).toThrow();});
 it('uses the normal ground-control queue shape',()=>{expect(operatorPlaySteps('play.walk',{direction:'left',durationMs:250})).toEqual([{skill:'control',mode:'ground',keys:['left'],durationMs:250}]);});
 it('rejects flight, jumps, long holds and unknown fields',()=>{for(const value of [{direction:'jump'},{durationMs:501},{durationMs:NaN},{direction:'forward',mode:'flight'}])expect(()=>operatorPlaySteps('play.walk',value)).toThrow();});
 it('allows bounded relative look and close, not arbitrary code',()=>{expect(operatorPlaySteps('play.look',{yawDeg:90})?.[0]).toMatchObject({skill:'control',keys:[],orientation:'relative',yawDeg:90,pitchDeg:0});expect(operatorPlaySteps('play.close',{})).toEqual([]);expect(()=>operatorPlaySteps('play.eval',{code:'x'})).toThrow();expect(()=>operatorPlaySteps('play.look',{yawDeg:181})).toThrow();});
});
