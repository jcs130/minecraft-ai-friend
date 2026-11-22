type Client<W> = { currentWindow: W | null };
type WindowMatcher<W> = (window: W) => boolean;

export interface DetachedStorageOpener {
  readonly command: string;
  readonly titles: readonly string[];
}

export function detachedStorageMatcher(openers: readonly DetachedStorageOpener[], command: string): WindowMatcher<string> | undefined {
  const key = command.trim().replace(/[ \t]+/g, ' ').toLowerCase();
  const opener = openers.find(candidate => candidate.command === key);
  return opener ? title => opener.titles.includes(title.trim()) : undefined;
}

// Match the command/open grace and the existing adopted-window idle interval.
const COMMAND_GRACE_MS = 5_000;
const IDLE_MS = 120_000;

/** A server pack may claim a detached storage opener. No other GUI is a cleanup candidate. */
export class DetachedStorageWindow<W extends object> {
  private expectation: { client: Client<W>; baseline: W | null; matcher: WindowMatcher<W>; sentAt: number } | null = null;
  private open: { client: Client<W>; window: W; lastUseAt: number } | null = null;

  expect(client: Client<W> | null, matcher: WindowMatcher<W> | undefined, now = Date.now()): void {
    this.expectation = client && matcher ? { client, baseline: client.currentWindow, matcher, sentAt: now } : null;
  }

  opened(client: Client<W>, window: W | null, now = Date.now()): void {
    const expect = this.expectation;
    this.expectation = null;
    const age = expect ? now - expect.sentAt : NaN;
    this.open = window && expect && expect.client === client && window !== expect.baseline
      && age >= 0 && age <= COMMAND_GRACE_MS && expect.matcher(window)
      ? { client, window, lastUseAt: now } : null;
  }

  touched(client: Client<W>, now = Date.now()): void {
    const open = this.open;
    if (open?.client === client && open.window === client.currentWindow) open.lastUseAt = now;
  }

  expired(client: Client<W>, lastClickAt: number, canClose: () => boolean, now = Date.now()): boolean {
    const open = this.open;
    if (!open) return false;
    if (open.client !== client || open.window !== client.currentWindow) {
      this.open = null;
      return false;
    }
    if (now - Math.max(open.lastUseAt, lastClickAt) < IDLE_MS || !canClose()) return false;
    this.open = null;
    return true;
  }
}
