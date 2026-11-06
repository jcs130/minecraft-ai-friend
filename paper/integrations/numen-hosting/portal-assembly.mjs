import {readFileSync} from 'node:fs';
import {portalHostingAuthority} from './src/portal-authority.mjs';
import {hostedPortalClient} from './src/portal-client.mjs';
export function hostedAgentsFactory({store,game}){
  const c=JSON.parse(readFileSync('/run/qd-hosting.json','utf8'));
  return hostedPortalClient({endpoint:'http://127.0.0.1:19084/v1/hosting',serviceKey:Buffer.from(c.serviceKey,'base64'),
    authority:portalHostingAuthority({store,serverId:'qiandengji',grantKey:Buffer.from(c.grantKey,'base64'),ordinaryRoles:()=>game.roster()})});
}
