import net from 'node:net';
import {readFileSync} from 'node:fs';

export function authState(file,now=Date.now()) {
  try {const s=JSON.parse(readFileSync(file,'utf8'));return s.ready===true && Number.isFinite(s.at) && now-s.at>=0 && now-s.at<5000 && Array.isArray(s.authorizedNames)?s:null;}
  catch{return null;}
}
export function proxyHeader(source,sourcePort,dest,destPort) {
  const ip=String(source).replace(/^::ffff:/,'');
  if(net.isIP(ip)!==4 || net.isIP(dest)!==4 || !Number.isInteger(sourcePort)||sourcePort<1||sourcePort>65535 || !Number.isInteger(destPort)||destPort<1||destPort>65535) throw Error('INVALID_PROXY_ADDRESS');
  return Buffer.from(`PROXY TCP4 ${ip} ${dest} ${sourcePort} ${destPort}\r\n`,'ascii');
}
/** For the trusted local Goddess only. Remote clients use the existing gateway,
 * which adds the same header. The proxy is bound exclusively to loopback. */
export function localProxyConnect(port) {
  return client=>{
    const s=net.connect({host:'127.0.0.1',port});
    const failed=error=>client.emit('error',error);s.once('error',failed);
    // setSocket forwards socket.connect automatically. Attach it only after
    // writing the trusted header, otherwise the MC handshake comes first.
    s.once('connect',()=>{s.off('error',failed);s.write(proxyHeader('127.0.0.1',s.localPort,'127.0.0.1',port));client.setSocket(s);client.emit('connect');});
  };
}
