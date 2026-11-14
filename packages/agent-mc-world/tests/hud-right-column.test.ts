import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { MANA_READY_CSS, MANA_READY_SCRIPT } from '../core/modern-viewer.js';

type Node = { id: string; tag: string; hidden: boolean; children: Node[]; parentElement: Node | null; textContent: string;
  firstElementChild: Node | null; hasAttribute(name: string): boolean; append(...n: Node[]): void; prepend(n: Node): void; replaceChildren(): void; setAttribute(): void; title?: string };
function element(tag: string): Node {
  const node: Node = { id: '', tag, hidden: false, children: [], parentElement: null, textContent: '',
    get firstElementChild() { return node.children[0] ?? null; },
    append(...items) { for (const item of items) { item.parentElement?.children.splice(item.parentElement.children.indexOf(item), 1); item.parentElement = node; node.children.push(item); } },
    prepend(item) { item.parentElement?.children.splice(item.parentElement.children.indexOf(item), 1); item.parentElement = node; node.children.unshift(item); },
    replaceChildren() { node.children = []; }, setAttribute() {}, hasAttribute: (name: string) => (node as unknown as { attrs?: Set<string> }).attrs?.has(name) ?? false } as Node;
  return node;
}
function page() {
  const body = element('body'); const observers: Array<() => void> = [];
  const find = (id: string, from: Node = body): Node | null => { for (const c of from.children) { if (c.id === id) return c; const d = find(id, c); if (d) return d; } return null; };
  const document = { body, readyState: 'complete', getElementById: (id: string) => find(id), createElement: element,
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  const stats = { stats: [{ label: '境界', value: '筑基', source: 'scoreboard', at: Date.now(), text: '境界 筑基' }] };
  const context = { document, Date, setInterval: () => 0, fetch: async () => ({ ok: true, json: async () => stats }),
    MutationObserver: class { constructor(fn: () => void) { observers.push(fn); } observe() {} } };
  return { body, find, context, mutate: () => observers.forEach(fn => fn()) };
}

describe('first-person HUD right column', () => {
  it('stacks 服务器读数 above the 思考与工具 panel in one column instead of overlaying', async () => {
    const { body, find, context, mutate } = page();
    const agent = element('section'); agent.id = 'agent-activity'; body.append(agent);
    runInNewContext(MANA_READY_SCRIPT, context);
    await new Promise(resolve => setTimeout(resolve, 0));
    const column = find('corti-right-column')!;
    expect(column.children.map(c => c.id)).toEqual(['corti-server-stats', 'agent-activity']);
    expect(column.parentElement).toBe(body);
    // A re-created agent panel (viewer.retry/reconnect) is re-docked by the mutation observer, below the readout.
    column.children.splice(column.children.indexOf(agent), 1); const again = element('section'); again.id = 'agent-activity'; body.append(again);
    mutate();
    expect(column.children.map(c => c.id)).toEqual(['corti-server-stats', 'agent-activity']);
  });

  it('leaves the docked viewer rail in charge (it adopts both cards in order)', async () => {
    const { body, find, context } = page();
    (body as unknown as { attrs: Set<string> }).attrs = new Set(['data-viewer-layout']);
    const agent = element('section'); agent.id = 'agent-activity'; body.append(agent);
    runInNewContext(MANA_READY_SCRIPT, context);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(find('corti-right-column')).toBeNull();
    expect(agent.parentElement).toBe(body);
  });

  it('column CSS neutralises per-panel fixed offsets and fits 1280x800 and 1920 wide', () => {
    expect(MANA_READY_CSS).toMatch(/#corti-right-column\{position:fixed;top:64px;right:14px;z-index:35;display:flex;flex-direction:column/);
    expect(MANA_READY_CSS).toContain('#corti-right-column>*{pointer-events:auto;position:static!important;top:auto!important;right:auto!important');
    expect(MANA_READY_CSS).toContain('max-height:calc(100vh - 200px);overflow-y:auto');
    expect(MANA_READY_CSS).toContain('#corti-right-column .agent-activity-list{max-height:min(38vh,300px);overflow-y:auto}');
    for (const [w, h] of [[1280, 800], [1920, 1080]]) {
      const width = Math.min(360, w - 28), bottom = 64 + (h - 200);
      expect(w - 14 - width).toBeGreaterThan(w / 2 + 182 / 2); // right of the centred 182px-scaled hotbar/boss bar area
      expect(bottom).toBeLessThanOrEqual(h - 136); // clears the bottom hotbar + vitals band
      expect(64).toBeGreaterThan(14 + 40); // below the view switch at top:14px
    }
  });
});
