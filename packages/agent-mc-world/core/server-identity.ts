/** Announce an Agent controller after login + world readiness, without changing
 * authentication, permissions or the chat receipt transport on other servers. */
export const AGENT_IDENTITY_CHANNEL = 'qiandengji:agent';
export function advertiseAgentIdentity(client: { write(name: string, params: any): unknown }, reconnect: boolean): boolean {
  try {
    client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from(AGENT_IDENTITY_CHANNEL, 'utf8') });
    client.write('custom_payload', { channel: AGENT_IDENTITY_CHANNEL,
      data: Buffer.from(JSON.stringify({ op: 'identity', protocol: 1, control: 'agent', reconnect }), 'utf8') });
    return true;
  } catch { return false; } // An optional server extension cannot break game entry.
}
