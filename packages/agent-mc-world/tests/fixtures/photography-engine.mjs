// Explicit offline factory: real capture service, no game or provider sockets.
import { PhotographyService, PHOTO_TOOL } from '../../core/photography.ts';
import { join } from 'node:path';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6NQAAAABJRU5ErkJggg==','base64');
export function createEngine(options) {
  let dispatches=0;
  const service=new PhotographyService({directory:join(options.dataDir,'photos'),
    capture:async()=>{const now=new Date().toISOString();return {bytes:png,mime:'image/png',capturedAt:now,sampledAt:now,captureId:'ipc-capture',facts:{position:[2,65,7]}};},
  });
  return {id:'minecraft',start:async host=>service.start(host),stop:async()=>service.stop(),
    console:()=>({lamps:[],storage:[]}),envPromptVars:()=>({}),envPromptRuntimeVars:()=>({'minecraft.current_task':'offline photo fixture','minecraft.goals':''}),
    requestFacts:()=>null,onTurnEnded:async()=>{},tools:()=>[{...PHOTO_TOOL,handler:(args,ctx)=>service.execute(args,ctx)}]};
}
