/** Types for bundled utilities, independent of the caller's framework. */
import type { Logger, LogLevel, LogAnchorFields, LogError } from './host-contract.ts';
export interface LogNote extends LogAnchorFields {
  kind: 'log'; level: LogLevel; area: string; msg: string; atMs: number;
  event?: string; durMs?: number; data?: unknown; err?: LogError;
}
export declare function nowIso(timezone: string, date?: Date): string;
export declare function nullLogger(): Logger;
export declare function createIpcLogger(send: (note: LogNote) => void, area?: string): Logger;
export declare function emitLogNote(root: Logger, note: LogNote, timezone: string): void;
export declare function logChildStdio(child: { stdout?: NodeJS.ReadableStream | null; stderr?: NodeJS.ReadableStream | null }, log: Logger): void;
export declare function logLines(stream: NodeJS.ReadableStream | null | undefined, log: Logger, level: LogLevel, event: string): void;
export declare function withAnchors<T>(anchors: LogAnchorFields, fn: () => T): T;
export declare function renderTemplate(template: string, vars: Record<string, string>): string;
