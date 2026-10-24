import type { EventEmitter } from 'node:events';
export interface ServerAuthState { authorized: boolean; status: string; passwordSet: boolean | null; nextCommand: string | null }
export function readProtectedCredential(file: string): Promise<Buffer>;
export function serverLoginFailureText(reason: string | null | undefined): string | null;
export function installServerLogin(bot: EventEmitter & { chat(text: string): void }, options: {
  server: string; username: string; configFile?: string;
  readCredential?(file: string): Promise<Buffer>;
  report?(status: { status: string; reason: string | null; username: string; server: string }): void;
}): { stop(): void; status(): { stage: string; attempted: boolean };
  detail(): { stage: string; attempted: boolean; reason: string | null; authState?: ServerAuthState }; ready(): boolean;
  authState(): ServerAuthState | null };
