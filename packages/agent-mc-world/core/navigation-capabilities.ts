/** Shared existing movement limits, also disclosed in the public goto contract. */
export const NAVIGATION_LIMITS = { maxDropDown: 2, allowParkour: true } as const;

export interface NavigationCapabilities {
  maxDropDown: number;
  allowParkour: boolean;
  jumpMode?: import('./policy.ts').JumpMode;
  /** Enabled for this probe profile; individual cells still need reach/permission checks. */
  canDig: boolean;
  /** Current inventory items accepted by this profile's actual scaffold list. */
  scaffoldCount: number;
}
