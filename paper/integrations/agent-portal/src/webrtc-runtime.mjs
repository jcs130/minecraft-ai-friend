import fs from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { isIP } from 'node:net';

// Operator-only configuration; never populated from a website request.
export function validateWebRtcConfig(value) {
  const range = value?.udpPortRange;
  if (value?.schemaVersion !== 1 || !Array.isArray(range) || range.length !== 2
      || !range.every(port => Number.isInteger(port) && port >= 1024 && port <= 65535)
      || range[1] < range[0] || range[1] - range[0] > 255
      || isIP(value.bindAddress || '') !== 4 || isIP(value.advertiseAddress || '') !== 4
      || !Array.isArray(value.iceServers) || value.iceServers.length < 1 || value.iceServers.length > 4
      || value.iceServers.some(server => Object.keys(server).some(k => k !== 'urls')
        || typeof server.urls !== 'string' || !/^stun:[a-z0-9.-]+:[0-9]{1,5}$/i.test(server.urls))) {
    throw Error('PORTAL_WEBRTC_CONFIGURATION');
  }
  return { schemaVersion: 1, udpPortRange: [...range], bindAddress: value.bindAddress,
    advertiseAddress: value.advertiseAddress, iceServers: value.iceServers.map(row => ({ urls: row.urls })) };
}

export async function loadWebRtcRuntime(configPath, { RTCPeerConnection } = {}) {
  if (!configPath) return null;
  if (!isAbsolute(configPath)) throw Error('PORTAL_WEBRTC_CONFIG must be an absolute operator path');
  const config = validateWebRtcConfig(JSON.parse(await fs.readFile(configPath, 'utf8')));
  const Peer = RTCPeerConnection || (await import('werift')).RTCPeerConnection;
  return { iceServers: config.iceServers, createPeerConnection: () => new Peer({
    iceServers: config.iceServers, icePortRange: config.udpPortRange,
    iceUseIpv4: true, iceUseIpv6: false,
    iceInterfaceAddresses: { udp4: config.bindAddress },
    iceAdditionalHostAddresses: [config.advertiseAddress],
  }) };
}
