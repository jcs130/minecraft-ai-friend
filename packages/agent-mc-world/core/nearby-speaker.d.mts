export interface NearbySpeakerOrigin {
  uuid: string;
  name: string;
  displayName: string;
  world: string;
  worldUuid: string;
  /** Epoch milliseconds from the server. For SVC, the start of the utterance. */
  observedAt: number;
  position: { x: number; y: number; z: number };
}

export function readNearbySpeaker(row: unknown, expectedUuid: string): NearbySpeakerOrigin | undefined;
export function nearbySpeakerFromDecoration(unsigned: unknown, senderUuid: string): NearbySpeakerOrigin | undefined;
export function nearbySpeakerContext(origin: NearbySpeakerOrigin): string;
