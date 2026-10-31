/** Advertise an installed optional decoder on this connection, never an identity or permission. */
export function declareDecodedChannels(client: {state?: string; write(name: string, value: any): unknown}, channels: readonly (string | undefined)[]): boolean {
  const valid=[...new Set(channels.filter((v):v is string=>typeof v==='string'&&/^[a-z0-9_.-]{1,64}:[a-z0-9_./-]{1,96}$/.test(v)))];
  if(client.state!=='play'||!valid.length||valid.length>64)return false;
  try{client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from(valid.join('\0'),'utf8')});return true;}
  catch{return false;} // Optional telemetry must not break normal game entry.
}
