import { minecraftTextComponent } from './text-component.ts';
import type { SkillCall } from './skills.ts';

/** Steps that consume the same open window, including explicitly dependent steps. */
export function consumesOpenWindow(call: SkillCall | undefined): boolean {
  return call?.skill === 'compact'
    || (call?.skill === 'stow' && call.into === 'open')
    || (call?.skill === 'take' && call.from === 'open');
}

/** A container needs both container slots and player slots; selection menus are excluded. */
export function storageWindow(window: {
  inventoryStart: number; inventoryEnd: number; title?: unknown;
} | null | undefined): boolean {
  return !!window && window.inventoryStart > 0 && window.inventoryEnd > window.inventoryStart
    && selectionMenuTitle(window.title) === null;
}

/** Explicit menu titles identify button GUIs; a chest name alone does not decide writability. */
export function selectionMenuTitle(title: unknown): string | null {
  const text = minecraftTextComponent(title).trim();
  return /技能罗盘|(?:^|\s)(?:skill|spell|ability)\s*(?:menu|compass)(?:\s|$)|菜单|選單|menu/i.test(text)
    ? text : null;
}
