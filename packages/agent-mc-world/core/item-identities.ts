import { zhName } from './names.ts';

/** Actual observed identities, without repeating quantities or guessing aliases. */
export function inventoryIdentityText(items: readonly { name: string; count: number }[]): string {
  return [...new Set(items.filter(item => item.count > 0).map(item => item.name))]
    .sort().map(name => `${zhName(name)}=${name}`).join('、');
}
