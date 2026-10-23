/** Entity details sent to the read-only Minecraft viewer. */

export function viewerMovementState(speed: number, sprinting: boolean, sneaking: boolean): string {
  const moving = speed > 0.08;
  if (sneaking) return moving ? 'crouchWalking' : 'crouch';
  if (!moving) return 'idle';
  return sprinting ? 'running' : 'walking';
}

export function viewerSheepAppearance(metadata: unknown,
  metadataKeys: readonly string[] | undefined): { colorId: number; sheared: boolean } {
  const index = metadataKeys?.indexOf('wool') ?? -1;
  const packed = index >= 0 && metadata && typeof metadata === 'object'
    ? (metadata as Record<number, unknown>)[index] : undefined;
  const value = typeof packed === 'number' && Number.isInteger(packed) ? packed : 0;
  return { colorId: value & 15, sheared: (value & 16) !== 0 };
}

export function observeViewerArmAnimation(
  protocol: { write(name: string, params?: Record<string, unknown>): void },
  publish: (hand: 'left' | 'right') => void,
): () => void {
  const originalWrite = protocol.write;
  const viewerWrite: typeof protocol.write = (name, params) => {
    originalWrite.call(protocol, name, params);
    if (name === 'arm_animation') publish(params?.hand === 1 ? 'left' : 'right');
  };
  protocol.write = viewerWrite;
  return () => { if (protocol.write === viewerWrite) protocol.write = originalWrite; };
}

/** Mirror the bot's actual outgoing attack command, without guessing from nearby mobs. */
export function observeViewerAttack(
  protocol: { write(name: string, params?: Record<string, unknown>): void },
  publish: (targetId: number) => void,
): () => void {
  const originalWrite = protocol.write;
  const viewerWrite: typeof protocol.write = (name, params) => {
    originalWrite.call(protocol, name, params);
    if (name === 'use_entity' && params?.mouse === true
      && Number.isSafeInteger(params.target) && Number(params.target) >= 0) {
      publish(Number(params.target));
    }
  };
  protocol.write = viewerWrite;
  return () => { if (protocol.write === viewerWrite) protocol.write = originalWrite; };
}

/** Mirror actual outgoing item-use packets to the read-only viewer. */
export function observeViewerRangedUse(
  protocol: { write(name: string, params?: Record<string, unknown>): void },
  heldItemName: () => string | undefined,
  publish: (event: { phase: 'draw' | 'release' | 'cancel'; kind: 'bow' | 'crossbow' | 'trident'; hand: 'left' | 'right' }) => void,
): () => void {
  const originalWrite = protocol.write;
  let active: { kind: 'bow' | 'crossbow' | 'trident'; hand: 'left' | 'right' } | null = null;
  const viewerWrite: typeof protocol.write = (name, params) => {
    originalWrite.call(protocol, name, params);
    if (name === 'use_item') {
      const item = String(heldItemName() || '').replace(/^minecraft:/, '');
      if (item === 'bow' || item === 'crossbow' || item === 'trident') {
        active = { kind: item, hand: params?.hand === 1 ? 'left' : 'right' };
        publish({ ...active, phase: 'draw' });
      }
    } else if (name === 'block_dig' && params?.status === 5 && active) {
      publish({ ...active, phase: 'release' });
      active = null;
    } else if (name === 'held_item_slot' && active) {
      publish({ ...active, phase: 'cancel' });
      active = null;
    }
  };
  protocol.write = viewerWrite;
  return () => { if (protocol.write === viewerWrite) protocol.write = originalWrite; };
}

/** The offhand shield has no useful client pose until its actual use packet is mirrored. */
export function observeViewerShieldUse(
  protocol: { write(name: string, params?: Record<string, unknown>): void },
  offhandItemName: () => string | undefined,
  publish: (raised: boolean) => void,
): () => void {
  const originalWrite = protocol.write;
  let raised = false;
  const setRaised = (next: boolean) => {
    if (next === raised) return;
    raised = next;
    publish(next);
  };
  const viewerWrite: typeof protocol.write = (name, params) => {
    originalWrite.call(protocol, name, params);
    if (name === 'use_item' && params?.hand === 1 &&
        String(offhandItemName() || '').replace(/^minecraft:/, '') === 'shield') setRaised(true);
    else if ((name === 'block_dig' && params?.status === 5) || name === 'held_item_slot') setRaised(false);
  };
  protocol.write = viewerWrite;
  return () => { if (protocol.write === viewerWrite) protocol.write = originalWrite; };
}
