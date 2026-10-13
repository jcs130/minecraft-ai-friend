import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import dgram from 'node:dgram';
import {syncBuiltinESMExports} from 'node:module';
let attempts=0;
const denied=()=>{attempts++;throw new Error('UNEXPECTED_NETWORK');};
process.on('beforeExit',()=>{if(attempts){process.stderr.write('UNEXPECTED_NETWORK attempts: '+attempts+'\n');process.exitCode=97;}});
globalThis.fetch=denied;
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  const first=Array.isArray(args[0])?args[0][0]:args[0];
  const path=typeof first==='string'?first:first?.path;
  // TSX uses local IPC; permit named pipes/domain sockets, never a TCP host/port.
  if(typeof path==='string' && (path.startsWith('\\\\.\\pipe\\') || path.startsWith('\\\\?\\pipe\\') || path.startsWith('/')))
    return connect.apply(this,args);
  return denied();
};
http.request=http.get=https.request=https.get=denied;
dns.lookup=dns.resolve=dns.promises.lookup=dns.promises.resolve=denied;
dgram.createSocket=denied;
syncBuiltinESMExports();
