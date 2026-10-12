import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import net from 'node:net';
import {EventEmitter,once} from 'node:events';
import {authState,proxyHeader,localProxyConnect} from './auth-proxy.mjs';

test('missing, corrupt, stale and future authentication health fail closed',()=>{
  const dir=mkdtempSync(join(tmpdir(),'mc-auth-health-')),file=join(dir,'health.json');
  try {
    assert.equal(authState(file,10000),null);
    for(const value of ['{',JSON.stringify({ready:false,at:10000,authorizedNames:[]}),
      JSON.stringify({ready:true,at:5000,authorizedNames:[]}),
      JSON.stringify({ready:true,at:10001,authorizedNames:[]}),
      JSON.stringify({ready:true,at:10000})]) {
      writeFileSync(file,value);assert.equal(authState(file,10000),null);
    }
    writeFileSync(file,JSON.stringify({ready:true,at:9999,authorizedNames:['ag_NEKO']}));
    assert.deepEqual(authState(file,10000).authorizedNames,['ag_NEKO']);
  } finally {try{unlinkSync(file);}catch{}rmdirSync(dir);}
});

test('trusted forwarding preserves real IPv4 and rejects header injection',()=>{
  assert.equal(proxyHeader('::ffff:192.168.3.133',12345,'127.0.0.1',25581).toString(),
    'PROXY TCP4 192.168.3.133 127.0.0.1 12345 25581\r\n');
  for(const args of [['1.2.3.4\r\nPROXY',1,'127.0.0.1',25581],
    ['1.2.3.4',0,'127.0.0.1',25581],['1.2.3.4',1,'127.0.0.1',65536]])
    assert.throws(()=>proxyHeader(...args),/INVALID_PROXY_ADDRESS/);
});

test('local Goddess sends trusted header before protocol handshake',async()=>{
  const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const received=once(server,'connection'),client=new EventEmitter();
  client.setSocket=s=>{client.socket=s;};
  client.on('connect',()=>client.socket.write('MC_HANDSHAKE'));
  localProxyConnect(server.address().port)(client);
  const [socket]=await received;let text='';
  try {
    await new Promise((resolve,reject)=>{
      socket.on('data',b=>{text+=b.toString();if(text.includes('MC_HANDSHAKE'))resolve();});
      socket.on('error',reject);
    });
    assert.match(text,/^PROXY TCP4 127\.0\.0\.1 127\.0\.0\.1 \d+ \d+\r\nMC_HANDSHAKE$/);
  } finally {client.socket?.destroy();socket.destroy();server.close();}
});
