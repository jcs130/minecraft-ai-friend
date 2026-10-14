// Explicit offline factory: real photography service and native adapter, no game or provider sockets.
import { PhotographyService, PHOTO_TOOL } from '../../core/photography.ts';
import { createImageGenerationPort } from '../../core/image-generation.ts';
import { join } from 'node:path';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6NQAAAABJRU5ErkJggg==','base64');
export function createEngine(options) {
  let dispatches=0;
  const service=new PhotographyService({directory:join(options.dataDir,'photos'),
    capture:async()=>{const now=new Date().toISOString();return {bytes:png,mime:'image/png',capturedAt:now,sampledAt:now,captureId:'ipc-capture',facts:{position:[2,65,7]}};},
    provider:()=>createImageGenerationPort(options.cfg.photography,{env:{FIXTURE_PHOTO_KEY:'fixture-only'},fetch:async(url,init)=>{
      if(String(url)!=='https://offline-image.invalid/api/native' || init.method!=='POST')throw new Error('Unexpected fixture request');
      const request=JSON.parse(init.body);
      if(request.image.length!==2 || !request.image.every(value=>value===`data:image/png;base64,${png.toString('base64')}`))throw new Error('Reference IPC transfer/order failed');
      dispatches++;
      return new Response(JSON.stringify({data:[{b64_json:png.toString('base64')}],usage:{generated_images:dispatches}}),{headers:{'x-request-id':'native-ipc-request'}});
    }}),
  });
  return {id:'minecraft',start:async host=>service.start(host),stop:async()=>service.stop(),
    console:()=>({lamps:[],storage:[]}),envPromptVars:()=>({}),envPromptRuntimeVars:()=>({'minecraft.current_task':'offline photo fixture','minecraft.goals':''}),
    requestFacts:()=>null,onTurnEnded:async()=>{},tools:()=>[{...PHOTO_TOOL,handler:(args,ctx)=>service.execute(args,ctx)}]};
}
