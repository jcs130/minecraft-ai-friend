export function unwrapNbt(node: unknown, depth?: number): unknown;
export function collectActionIds(node: unknown, out?: string[]): string[];
export function minecraftTextComponent(value: unknown, options?: { trim?: boolean; limit?: number }): string;
export function windowTitleText(title: unknown, rawTitle?: unknown): string;
export function isAuthMeLoginDialog(dialog: unknown): boolean;
export function authMePasswordNbt(password: string): { type: 'compound'; value: { password: { type: 'string'; value: string } } };
/** language table used to resolve `translate` keys. */
export function setMinecraftTextLanguage(language: Record<string, string> | null | undefined): void;
