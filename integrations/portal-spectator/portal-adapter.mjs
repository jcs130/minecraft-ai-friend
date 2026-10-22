import path from 'node:path';
import { loadSpectatorSite } from './spectator-vendor/spectator-site.mjs';
import { createSpectatorRelay } from './spectator-vendor/spectator-relay.mjs';

/** Thin portal-owned ACL adapter. No session store, game login or controller is
 * created here; the live website remains the only authority for ownership.
 * Copy beside the portal's existing src modules when integrating the site.
 */
export async function createPortalSpectator({ config, live, browserAuth, store, WebSocketServer }) {
  if (config.live?.native3dEnabled !== true) return {
    http: async () => false, upgrade: () => false, close: async () => {},
    state: () => ({ available: false, enabled: false, readOnly: true }),
    decorate: row => row
  };
  const directory = config.live.native3dSiteDirectory;
  if (!path.isAbsolute(directory ?? '')) throw Error('Native 3D requires an operator-deployed absolute site directory');
  const site = await loadSpectatorSite(directory);
  const relay = createSpectatorRelay({ WebSocketServer, site,
    authorizePublisher(req, channelId, token) {
      if (req.headers.origin && ![config.publicOrigin, ...(config.localOrigins ?? [])].includes(req.headers.origin)) throw Error('Publisher origin rejected');
      const channel = live.publisher({ headers: { authorization: 'Bearer ' + token } }, channelId);
      return { playerUuid: channel.player_uuid };
    },
    authorizeViewer(req, channelId) {
      const { owner } = browserAuth(req), channel = live.channel(channelId);
      if (!channel || owner.role !== 'admin' && !store.ownedUuids(owner.id).includes(channel.player_uuid)) throw Error('Private 3D unavailable');
      // Deliberately ignore the old JPEG visibility=public setting: it does
      // not authorize disclosing a full inventory, menu or private chat feed.
    }
  });
  return { ...relay, decorate(row) {
    if (!row.canManage) return row;
    const state = relay.state(row.id);
    return { ...row, native3d: { ...state, enabled: true }, watchUrl: `/watch/${row.id}/` };
  } };
}
