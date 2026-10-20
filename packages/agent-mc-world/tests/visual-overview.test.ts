import { describe, expect, it } from 'vitest';
import { overviewArgumentError } from '../core/visual-overview.ts';
import { visualArgumentError, observeVisual } from '../src/client/visual.ts';
import { MinecraftViewCaptureManager } from '../core/visual-capture.ts';
import type { WorldHost } from '../src/client/contracts.ts';

describe('coordinate overview contract', () => {
  it('accepts bounded cameras and rejects unsupported combinations before rendering', () => {
    expect(visualArgumentError({mode:'overview'})).toBeUndefined();
    expect(visualArgumentError({mode:'overview',overview:{center:[-545,-436],span:64,grid:4,markers:[{at:[-541,64,-438],label:'bridge'}]}})).toBeUndefined();
    for (const overview of [null,[],{center:[NaN,0]}, {span:2049}, {grid:1.5}, {grid:'dense'}, {labels:'all'}, {markers:Array(129).fill({at:[0,1,2]})},
      {markers:[{at:[0,1,2],label:'x\ny'}]}, {markers:[{at:[.5,1,2]}]}, {markers:[{at:[0,1,2],anchor:'corner'}]}, {unknown:true}])
      expect(overviewArgumentError('overview',overview,false)).toBeTruthy();
    expect(visualArgumentError({mode:'third',overview:{}})?.failed).toBe(true);
    expect(visualArgumentError({mode:'overview',include_hud:true})?.failed).toBe(true);
  });

  it('supports large scenes, many cells, auto grids and explicit exact positions', () => {
    const markers = Array.from({length:128}, (_,i)=>({at:[-i,64,-i],label:`cell ${i}`}));
    expect(visualArgumentError({mode:'overview',overview:{span:2048,grid:'auto',labels:'ids',markers}})).toBeUndefined();
    expect(visualArgumentError({mode:'overview',overview:{span:512,grid:32,labels:'full'}})).toBeUndefined();
    expect(visualArgumentError({mode:'overview',overview:{grid:3,markers:[{at:[-1.75,64,-2],anchor:'position'}]}})).toBeUndefined();
    expect(visualArgumentError({mode:'overview',overview:{markers:[{at:[-1,64,-2],anchor:'position'}]}})).toBeUndefined();
  });

  it('uses shared image capability gate without claiming a rendered map from facts', async () => {
    let called=false;
    const result=await observeVisual({name:'mc_visual',description:'',tags:['read'],parameters:{type:'object'},
      handler:()=>{called=true;return 'image';}}, {mode:'overview'}, {} as never,
      {modelFacts:{accepts:()=>false}} as unknown as WorldHost, ()=>null, false);
    expect(called).toBe(false); expect(typeof result==='string'?result:result.text).toContain('没有图像分析结论');
  });

  it('accepts explicit task attention and rejects ambiguous or invalid regions before capture', async () => {
    const attention={regions:[{bounds:[-544,-430,-537,-423],label:'uncertain support'}],detail:1};
    expect(visualArgumentError({mode:'overview',overview:{attention}})).toBeUndefined();
    expect(visualArgumentError({mode:'overview',overview:{attention:{...attention,detail:0}}})).toBeUndefined();
    for(const invalid of [null,[],{}, {regions:[]},{regions:Array(33).fill({bounds:[0,0,1,1]})},
      {regions:[{bounds:[0,0,Infinity,1]}]},{regions:[{bounds:[0,0,0,1]}]},{regions:[{bounds:[0,0,2049,1]}]},
      {regions:[{bounds:[0,0,1,1],weight:1}]},{...attention,detail:2},{...attention,detail:-1},{...attention,detail:1.5}])
      expect(visualArgumentError({mode:'overview',overview:{attention:invalid}})?.failed).toBe(true);
    let calls=0;
    const manager=new MinecraftViewCaptureManager({fetcher:(()=>{calls++;throw new Error('network');}) as typeof fetch});
    await expect(manager.capture({viewerUrl:'http://127.0.0.1:7793',mode:'overview',overview:{attention:{...attention,detail:2}} as never})).rejects.toThrow('attention');
    expect(calls).toBe(0);
  });

  it('capture API rejects bad coordinates without opening browser or reading health', async () => {
    let called=false;
    const manager=new MinecraftViewCaptureManager({fetcher:(()=>{called=true;throw new Error('network');}) as typeof fetch});
    await expect(manager.capture({viewerUrl:'http://127.0.0.1:7793',mode:'overview',overview:{span:Infinity}})).rejects.toThrow('8..2048');
    expect(called).toBe(false);
  });

  it('returns annotated image and aligned metadata, reusing a page with fresh camera arguments', async () => {
    const inputs: unknown[]=[];let opened=0,closed=0;let url='';
    const metadata={schema:'mc-overview/v3',capturedAt:'2026-10-13T04:00:00.000Z',width:1280,height:720};
    const page={isClosed:()=>false,close:async()=>{closed++;},goto:async(value:string)=>{url=value;},addStyleTag:async()=>{},
      waitForFunction:async()=>({jsonValue:async()=>'ready',dispose:async()=>{}}),
      evaluate:async(fn:{name:string},input:unknown)=>{
        if(fn.name==='setViewerCaptureActive')return true;
        if(fn.name==='viewerCaptureRenderer')return {renderer:'fixture',vendor:'fixture',software:false};
        if(typeof input==='boolean')return undefined;
        inputs.push(input);return {png:'data:image/png;base64,iVBORw0KGgo=',metadata};
      },screenshot:()=>{throw new Error('must not lose annotations via ordinary screenshot');}};
    const manager=new MinecraftViewCaptureManager({fetcher:(async()=>new Response(JSON.stringify({ok:true,maxCaptureSessions:1,captureSessions:0}))) as typeof fetch,
      launchBrowser:async()=>({isConnected:()=>true,newPage:async()=>{opened++;return page;},close:async()=>{}}) as never});
    try {
      const requests=[{span:16},{span:48,attention:{regions:[{bounds:[-4,-4,4,4]}],detail:1}}];
      for(const overview of requests) {
        const result=await manager.capture({viewerUrl:'http://127.0.0.1:7793',mode:'overview',overview:overview as never});
        expect(result.png.subarray(1,4).toString()).toBe('PNG');
        expect(result.capturedAt).toBe(metadata.capturedAt);expect(result.overview).toEqual(metadata);
      }
      expect(inputs).toEqual(requests);expect(opened).toBe(1);expect(url).toBe('http://127.0.0.1:7793/third/?photo=1&capture=1');
    } finally {await manager.stop();}
    expect(closed).toBe(1);
  });

  it('unsupported renderer gives an explicit failure, not a mislabeled normal photograph', async () => {
    let closed=false;
    const manager=new MinecraftViewCaptureManager({fetcher:(async()=>new Response(JSON.stringify({ok:true}))) as typeof fetch,
      launchBrowser:async()=>({isConnected:()=>true,close:async()=>{},newPage:async()=>({
        isClosed:()=>false,close:async()=>{closed=true;},goto:async()=>{},addStyleTag:async()=>{},
        waitForFunction:async()=>({jsonValue:async()=>'ready',dispose:async()=>{}}),
        evaluate:async(fn:{name:string},input:unknown)=>{if(fn.name==='setViewerCaptureActive')return false;
          if(fn.name==='viewerCaptureRenderer')return {renderer:'fixture',vendor:'fixture',software:false};
          if(typeof input!=='boolean')throw new Error('overview renderer unavailable');},
      })}) as never});
    await expect(manager.capture({viewerUrl:'http://127.0.0.1:7793',mode:'overview'})).rejects.toThrow('overview renderer unavailable');
    expect(closed).toBe(true);
  });

  it('rejects old corner-based captures rather than describing them as centered', async () => {
    const manager=new MinecraftViewCaptureManager({fetcher:(async()=>new Response(JSON.stringify({ok:true}))) as typeof fetch,
      launchBrowser:async()=>({isConnected:()=>true,close:async()=>{},newPage:async()=>({
        isClosed:()=>false,close:async()=>{},goto:async()=>{},addStyleTag:async()=>{},
        waitForFunction:async()=>({jsonValue:async()=>'ready',dispose:async()=>{}}),
        evaluate:async(fn:{name:string},input:unknown)=>fn.name==='setViewerCaptureActive'?false
          :fn.name==='viewerCaptureRenderer'?{renderer:'fixture',vendor:'fixture',software:false}
          :typeof input==='boolean'?undefined:{png:'data:image/png;base64,iVBORw0KGgo=',metadata:{schema:'mc-overview/v1'}},
      })}) as never});
    try { await expect(manager.capture({viewerUrl:'http://127.0.0.1:7793',mode:'overview'})).rejects.toThrow('坐标协议版本不匹配'); }
    finally { await manager.stop(); }
  });
});
