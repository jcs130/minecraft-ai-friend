import { afterEach, expect, it, vi } from 'vitest';
import { captureBrowserArgs, MinecraftViewCaptureManager } from '../core/visual-capture.ts';

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
function fixture({ protocol = true, expectedRenderer }: { protocol?: boolean; expectedRenderer?: string } = {}) {
  const states: boolean[] = [];
  const png = Buffer.from('iVBORw0KGgo=', 'base64');
  const pageClose = vi.fn(async () => {}), browserClose = vi.fn(async () => {});
  const screenshot = vi.fn(async () => png);
  const page = {isClosed:()=>false,close:pageClose,goto:async()=>{},addStyleTag:async()=>{},
    waitForFunction:async()=>({jsonValue:async()=>'ready',dispose:async()=>{}}),
    evaluate:async(fn:{name:string}, input:unknown)=> {
      if(fn.name==='setViewerCaptureActive') { states.push((input as {active:boolean}).active); return protocol; }
      if(fn.name==='viewerCaptureRenderer')return {renderer:'ANGLE (AMD Radeon Graphics)',vendor:'AMD',software:false};
      return typeof input==='boolean'?undefined:120;
    }, locator:()=>({screenshot})};
  const launchBrowser=vi.fn(async()=>({isConnected:()=>true,close:browserClose,newPage:async()=>page}) as never);
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({ok:true,maxCaptureSessions:1,captureSessions:0})));
  const manager=new MinecraftViewCaptureManager({fetcher,launchBrowser}, {idleTimeoutMs:1_000,expectedRenderer});
  return {manager,states,pageClose,browserClose,launchBrowser,fetcher,screenshot};
}
const request={viewerUrl:'http://127.0.0.1:19761'};

it('pauses a reusable capture page, releases idle browser, and does not revive it after stop',async()=>{
  vi.useFakeTimers();
  const f=fixture();
  const first=await f.manager.capture(request);
  expect(first.idleRendering).toBe('paused');
  expect(first.renderer).toMatchObject({requestedPreference:'low-power',renderer:expect.stringContaining('AMD')});
  await vi.advanceTimersByTimeAsync(600);
  const second=await f.manager.capture(request);
  expect(second.timings?.reusedPage).toBe(true);
  expect(f.states).toEqual([true,false,true,false]);
  await vi.advanceTimersByTimeAsync(600);
  expect(f.browserClose).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(401);
  expect(f.pageClose).toHaveBeenCalledTimes(1);expect(f.browserClose).toHaveBeenCalledTimes(1);
  await f.manager.stop();await vi.advanceTimersByTimeAsync(60_000);
  expect(f.launchBrowser).toHaveBeenCalledTimes(1);
});
it('closes older-viewer pages immediately rather than leaving their renderer running',async()=>{
  const f=fixture({protocol:false});
  try {expect((await f.manager.capture(request)).idleRendering).toBe('page-closed');expect(f.pageClose).toHaveBeenCalledTimes(1);}
  finally {await f.manager.stop();}
});
it('rejects the wrong actual GPU before taking a photograph and releases the browser',async()=>{
  const f=fixture({expectedRenderer:'NVIDIA'});
  await expect(f.manager.capture(request)).rejects.toMatchObject({code:'renderer',message:expect.stringContaining('AMD')});
  expect(f.screenshot).not.toHaveBeenCalled();expect(f.browserClose).toHaveBeenCalledTimes(1);
  await f.manager.stop();
});
it('validates GPU policy before opening a browser or network connection',async()=>{
  vi.stubEnv('AGENT_MC_CAPTURE_GPU','unknown');
  const f=fixture();await expect(f.manager.capture(request)).rejects.toThrow('gpuPreference');
  expect(f.fetcher).not.toHaveBeenCalled();expect(f.launchBrowser).not.toHaveBeenCalled();
  expect(captureBrowserArgs('low-power','win32')).toContain('--force_low_power_gpu=1');
  expect(captureBrowserArgs('high-performance','linux')).not.toContain('--use-angle=d3d11');
  await f.manager.stop();
});
it('cancels an in-flight renderer wait and never schedules idle resurrection',async()=>{
  vi.useFakeTimers();const f=fixture();const controller=new AbortController();
  let release!:()=>void;
  f.screenshot.mockImplementation(async()=>{await new Promise<void>(resolve=>{release=resolve;});return Buffer.from('PNG');});
  const pending=f.manager.capture({...request,signal:controller.signal});
  const rejected=expect(pending).rejects.toMatchObject({code:'cancelled'});
  while(!release)await Promise.resolve();
  controller.abort();release();await rejected;
  await f.manager.stop();await vi.advanceTimersByTimeAsync(60_000);
  expect(f.launchBrowser).toHaveBeenCalledTimes(1);expect(f.browserClose).toHaveBeenCalledTimes(1);
});
it('closes a browser that finishes launching after stop instead of installing a new session',async()=>{
  const f=fixture(), original=f.launchBrowser.getMockImplementation()!;
  let release!:()=>void;
  f.launchBrowser.mockImplementationOnce(async()=>{await new Promise<void>(resolve=>{release=resolve;});return original();});
  const pending=f.manager.warm(request.viewerUrl);
  const rejected=expect(pending).rejects.toMatchObject({code:'cancelled'});
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  await f.manager.stop();release();await rejected;
  expect(f.browserClose).toHaveBeenCalledTimes(1);expect(f.states).toEqual([]);
});
