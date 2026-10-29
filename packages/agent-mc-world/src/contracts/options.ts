/** Discovery data, not an executable plan, current permission or model policy. */
export const MINECRAFT_OPTION_INTENTS = ['food', 'equipment', 'travel', 'water', 'inventory', 'explore', 'method'] as const;
export type MinecraftOptionIntent = typeof MINECRAFT_OPTION_INTENTS[number];
export interface MinecraftOption {
  id: string;
  intents: readonly MinecraftOptionIntent[];
  title: string;
  purpose: string;
  /** Support describes the implementation. It does not establish current eligibility. */
  support: 'supported' | 'unsupported' | 'unknown';
  evidence: readonly string[];
  checks: readonly string[];
  read: readonly { tool: string; args: Readonly<Record<string, unknown>> }[];
  source: { kind: 'core' | 'server-observation'; reference: string; observedAt?: string };
}
export interface MinecraftOptionContext {
  sampledAt: string;
  backend: 'mineflayer' | 'java-client';
  food: number | null;
  oxygen: number | null;
  inWater: boolean | null;
  /** null means unavailable/unclassified; zero means observed none in carried inventory only. */
  carriedFood: number | null;
  carriedBoats: number | null;
  /** Recognized native melee gear and ordinary arrows in the current carried sample only. */
  meleeEquipment?: readonly string[] | null;
  arrows?: number | null;
  freeSlots: number | null;
  travelling: boolean;
  bodyTask: string | null;
  bodyRestriction: string | null;
}
export interface MinecraftOptionsSnapshot {
  schema: 'minecraft-options/v1';
  context: MinecraftOptionContext;
  options: readonly MinecraftOption[];
}
