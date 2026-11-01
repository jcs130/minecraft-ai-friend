import {applyDependencySourcePatch} from '../core/dependency-patches.ts';
import {runInNewContext} from 'node:vm';
import {describe,expect,it} from 'vitest';

const filename='/owned/node_modules/mineflayer/lib/plugins/game.js';
const modern=`    if ((packet.reason === 4 || packet.reason === 'win_game') && packet.gameMode === 1) {
      bot._client.write('client_command', { actionId: 'perform_respawn' })
    }`;
const legacy=`    if ((packet.reason === 4 || packet.reason === 'win_game') && packet.gameMode === 1) {
      bot._client.write('client_command', { action: 0 })
    }`;

describe('reviewed upstream source variants',()=>{
  it.each([0,1])('new mapper-based upstream acknowledges End exit with credit flag %s',gameMode=>{
    const writes:unknown[]=[];
    runInNewContext(applyDependencySourcePatch(filename,modern),{
      packet:{reason:'win_game',gameMode},bot:{_client:{write:(name:string,value:unknown)=>writes.push({name,value})}},
    });
    expect(writes).toEqual([{name:'client_command',value:{actionId:'perform_respawn'}}]);
  });
  it('does not invent a respawn for an unrelated game event',()=>{
    const writes:unknown[]=[];
    runInNewContext(applyDependencySourcePatch(filename,modern),{packet:{reason:3,gameMode:1},bot:{_client:{write:(...args:unknown[])=>writes.push(args)}}});
    expect(writes).toEqual([]);
  });
  it('retains legacy payload codecs and rejects unreviewed source',()=>{
    for(const payload of [true,false]){
      const writes:unknown[]=[];
      runInNewContext(applyDependencySourcePatch(filename,legacy),{
        packet:{reason:4,gameMode:0},bot:{supportFeature:()=>payload,_client:{write:(_name:string,value:unknown)=>writes.push(value)}},
      });
      expect(writes).toEqual([payload?{payload:0}:{actionId:0}]);
    }
    expect(()=>applyDependencySourcePatch(filename,'unreviewed upstream')).toThrow('找不到');
  });
  it('rejects duplicate and mixed matching variants instead of selecting one',()=>{
    expect(()=>applyDependencySourcePatch(filename,modern+'\n'+modern)).toThrow('不唯一');
    expect(()=>applyDependencySourcePatch(filename,legacy+'\n'+modern)).toThrow('不唯一');
  });
  it('does not patch a different package path',()=>{
    expect(applyDependencySourcePatch('/owned/other/game.js',modern)).toBe(modern);
  });
});
