import { loadConfig } from './config.mjs';
import { createPortal } from './server.mjs';

const config = loadConfig();
const portal = createPortal(config);
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
