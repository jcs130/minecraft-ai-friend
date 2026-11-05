/** A real received sound's coarse bearing at that time, not entity localization. */
export interface HearingHint {
  source: 'sound-packet'; kind: string; direction: string; distance: string; heardAt: number; expiresAt: number;
  /** Listener's own measured location, never the sound source's precise coordinates. */
  origin?: [number,number,number];
}
