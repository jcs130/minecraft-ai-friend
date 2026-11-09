import { loadConfig } from './config.mjs';
import { createPortal } from './server.mjs';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadWebRtcRuntime} from './webrtc-runtime.mjs';

const config = loadConfig();
// Operator assembly only, never a URL/path accepted by the website. With no
// adapter the existing website stays unchanged and the unfinished UI is hidden.
let hostedAgentsFactory;
if(process.env.PORTAL_HOSTING_ADAPTER){
  if(!isAbsolute(process.env.PORTAL_HOSTING_ADAPTER))throw new Error('PORTAL_HOSTING_ADAPTER must be an absolute local path');
  ({hostedAgentsFactory}=await import(pathToFileURL(process.env.PORTAL_HOSTING_ADAPTER).href));
  if(typeof hostedAgentsFactory!=='function')throw new Error('Hosting adapter must export hostedAgentsFactory');
}
const webRtc = await loadWebRtcRuntime(process.env.PORTAL_WEBRTC_CONFIG);
const portal = createPortal(config,{hostedAgentsFactory,webRtc});
await portal.ready;
portal.server.listen(config.port, config.host, () => {
  console.log(`${config.siteName} Agent Portal: http://${config.host}:${portal.server.address().port}`);
  console.log('独立门户已启动；游戏资料只读，建号、绑定和改密由认证桥单独确认。');
});
portal.server.on('error', error => { console.error('Portal startup failed:', error.code || error.name); portal.store.close(); process.exitCode = 1; });
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (stopping) return; stopping = true;
  await portal.close(); process.exitCode = 0;
});
