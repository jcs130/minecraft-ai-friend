import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateWebRtcConfig,loadWebRtcRuntime} from '../src/webrtc-runtime.mjs';
const valid={schemaVersion:1,udpPortRange:[35000,35127],bindAddress:'10.0.0.1',advertiseAddress:'192.0.2.1',iceServers:[{urls:'stun:stun.example.org:3478'}]};
test('WebRTC stays off without operator configuration; arbitrary requests cannot choose backend or credentials',async()=>{
 assert.equal(await loadWebRtcRuntime(),null);
 await assert.rejects(()=>loadWebRtcRuntime('relative.json'),/absolute/);
 for(const patch of [{udpPortRange:[80,90]},{udpPortRange:[35000,40000]},{advertiseAddress:'host.example'},{iceServers:[]},{iceServers:[{urls:'turn:example:3478',credential:'secret'}]}])assert.throws(()=>validateWebRtcConfig({...valid,...patch}),/CONFIGURATION/);
});
test('operator runtime binds bounded UDP candidates and advertises only explicit STUN config',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'qd-rtc-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'config.json');await fs.writeFile(file,JSON.stringify(valid));
 class Peer{constructor(options){this.options=options;}}
 const runtime=await loadWebRtcRuntime(file,{RTCPeerConnection:Peer}),peer=runtime.createPeerConnection();
 assert.deepEqual(runtime.iceServers,valid.iceServers);assert.deepEqual(peer.options.icePortRange,valid.udpPortRange);
 assert.deepEqual(peer.options.iceInterfaceAddresses,{udp4:valid.bindAddress});assert.deepEqual(peer.options.iceAdditionalHostAddresses,[valid.advertiseAddress]);assert.equal(peer.options.iceUseIpv6,false);
});
