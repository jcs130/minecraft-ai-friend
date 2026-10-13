// Verification preload only: fail before any network connection or listener.
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { register, syncBuiltinESMExports } from 'node:module';

const deny = () => { throw new Error('OFFLINE_CHECK_NETWORK_FORBIDDEN'); };
net.Socket.prototype.connect = deny;
net.Server.prototype.listen = deny;
tls.connect = deny;
dgram.createSocket = deny;
globalThis.fetch = deny;
syncBuiltinESMExports();
register(new URL('./deny-cortico.mjs', import.meta.url));
