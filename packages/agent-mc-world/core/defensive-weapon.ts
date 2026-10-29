import { chooseHybridWeapon, type HybridWeapon } from './ranged.ts';

export interface DefensiveWeaponFrame {
  phase: 'start' | 'tick';
  current: HybridWeapon;
  heldItem: string | null;
  rangedReady: boolean;
  meleeReady: boolean;
  distance: number | null;
}

/** One automatic encounter preserves an already equipped, ready ranged weapon.
 * Explicit attack tasks retain their own mode and never use this selector.
 * An inventory bow or a spoken plan alone is not an equipped weapon choice.
 */
export function createDefensiveWeaponSelector(): (frame: DefensiveWeaponFrame) => HybridWeapon {
  let preserveRanged = false;
  return frame => {
    if (frame.phase === 'start') preserveRanged = frame.rangedReady
      && (frame.heldItem === 'bow' || frame.heldItem === 'crossbow');
    if (frame.rangedReady && (preserveRanged || !frame.meleeReady)) return 'ranged';
    return frame.distance === null ? 'melee'
      : chooseHybridWeapon(frame.current, frame.distance, frame.rangedReady);
  };
}
