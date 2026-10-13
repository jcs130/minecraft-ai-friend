import { describe, expect, it } from 'vitest';
import { overviewArgumentError } from '../core/visual-overview.ts';
import { visualArgumentError, observeVisual } from '../src/client/visual.ts';
import { MinecraftViewCaptureManager } from '../core/visual-capture.ts';
import type { WorldHost } from '../src/client/contracts.ts';

describe('coordinate overview contract', () => {
  it('accepts bounded cameras and rejects unsupported combinations before rendering', () => {
    expect(visualArgumentError({mode:'overview'})).toBeUndefined();
    expect(visualArgumentError({mode:'overview',overview:{center:[-545,-436],span:64,grid:4,markers:[{at:[-541,64,-438],label:'bridge'}]}})).toBeUndefined();
    for (const overview of [null,[],{center:[NaN,0]}, {span:97}, {grid:3}, {markers:Array(9).fill({at:[0,1,2]})},
      {markers:[{at:[0,1,2],label:'x\ny'}]}, {unknown:true}])
      expect(overviewArgumentError('overview',overview,false)).toBeTruthy();
    expect(visualArgumentError({mode:'third',overview:{}})?.failed).toBe(true);
    expect(visualArgumentError({mode:'overview',include_hud:true})?.failed).toBe(true);
  });

  it('uses shared image capability gate without claiming a rendered map from facts', async () => {
    let called=false;
    const result=await observeVisual({name:'mc_visual',description:'',tags:['read'],parameters:{type:'object'},
      handler:()=>{called=true;return 'image';}}, {mode:'overview'}, {} as never,
      {modelFacts:{accepts:()=>false}} as unknown as WorldHost, ()=>null, false);
    expect(called).toBe(false); expect(typeof result==='string'?result:result.text).toContain('没有图像分析结论');
  });

  it('capture API rejects bad coordinates without opening browser or reading health', async () => {
    let called=false;
    const manager=new MinecraftViewCaptureManager({fetcher:(()=>{called=true;throw new Error('network');}) as typeof fetch});
    await expect(manager.capture({viewerUrl:'http://127.0.0.1:7793',mode:'overview',overview:{span:Infinity}})).rejects.toThrow('8..96');
    expect(called).toBe(false);
  });

  it('returns annotated image and aligned metadata, reusing a page with fresh camera arguments', async () => {
    const inputs: unknown[]=[];let opened=0,closed=0;let url='';
    const metadata={schema:'mc-overview/v1',capturedAt:'2026-10-13T04:00:00.000Z',width:1280,height:720};
    const page={isClosed:()=>false,close:async()=>{closed++;},goto:async(value:string)=>{url=value;},addStyleTag:async()=>{},
      waitForFunction:async()=>({jsonValue:async()=>'ready',dispose:async()=>{}}),
      evaluate:async(_fn:unknown,input:unknown)=>{
        if(typeof input==='boolean')return undefined;
        inputs.push(input);return {png:'data:image/png;base64,iVBORw0KGgo=',metadata};
      },screenshot:()=>{throw new Error('must not lose annotations via ordinary screenshot');}};
    const manager=new MinecraftViewCaptureManager({fetcher:(async()=>new Response(JSON.stringify({ok:true,maxCaptureSessions:1,captureSessions:0}))) as typeof fetch,
      launchBrowser:async()=>({isConnected:()=>true,newPage:async()=>{opened++;return page;},close:async()=>{}}) as never});
    try {
      for(const span of [16,48]) {
        const result=await manager.capture({viewerUrl:'http://127.0.0.1:7793',mode:'overview',overview:{span}});
        expect(result.png.subarray(1,4).toString()).toBe('PNG');
        expect(result.capturedAt).toBe(metadata.capturedAt);expect(result.overview).toEqual(metadata);
      }
      expect(inputs).toEqual([{span:16},{span:48}]);expect(opened).toBe(1);expect(url).toBe('http://127.0.0.1:7793/third/?photo=1');
    } finally {await manager.stop();}
    expect(closed).toBe(1);
  });

  it('unsupported renderer gives an explicit failure, not a mislabeled normal photograph', async () => {
    let closed=false;
    const manager=new MinecraftViewCaptureManager({fetcher:(async()=>new Response(JSON.stringify({ok:true}))) as typeof fetch,
      launchBrowser:async()=>({isConnected:()=>true,close:async()=>{},newPage:async()=>({
        isClosed:()=>false,close:async()=>{closed=true;},goto:async()=>{},addStyleTag:async()=>{},
        waitForFunction:async()=>({jsonValue:async()=>'ready',dispose:async()=>{}}),
        evaluate:async(_fn:unknown,input:unknown)=>{if(typeof input!=='boolean')throw new Error('overview renderer unavailable');},
      })}) as never});
    await expect(manager.capture({viewerUrl:'http://127.0.0.1:7793',mode:'overview'})).rejects.toThrow('overview renderer unavailable');
    expect(closed).toBe(true);
  });
});
