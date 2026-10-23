import type { SkillCall } from './skills.ts';

const INSPECTION_COOLDOWN_MS = 90_000;

function inspectionTarget(steps: readonly SkillCall[]): string | null {
  if (steps.length !== 1 && steps.length !== 2) return null;
  if (steps.length === 2 && steps[0].skill !== 'goto') return null;
  const use = steps[steps.length - 1];
  if (use.skill !== 'use' || use.item || use.target || use.index !== undefined
    || (use.times ?? 1) !== 1 || use.text) return null;
  if (!Array.isArray(use.at) || use.at.length !== 3
    || !use.at.every((n) => Number.isInteger(n))) return null;
  return use.at.join(',');
}

/** A recent chest peek is historical information, never proof of current contents. */
export class InspectionGuard {
  private readonly seen = new Map<string, number>();

  block(steps: readonly SkillCall[], dimension: string, now: number): { text: string; retryAfterMs: number } | null {
    const target = inspectionTarget(steps);
    if (!target) return null;
    const at = this.seen.get(`${dimension}:${target}`);
    if (at === undefined || now - at >= INSPECTION_COOLDOWN_MS) return null;
    const retryAfterMs = INSPECTION_COOLDOWN_MS - (now - at);
    return {
      text: `刚查看过 (${target}) 的箱内物品，结果已在上一单回执中；重复走过去开箱不会搬动物品。`
        + '这不证明当前物品仍相同，本次仍可重新开窗核验',
      retryAfterMs,
    };
  }

  record(steps: readonly SkillCall[], dimension: string,
    landings: readonly { step: number; outcome: string; line: string }[], now: number): void {
    const target = inspectionTarget(steps);
    if (!target) return;
    const use = landings.find((landing) => landing.step === steps.length);
    if (use?.outcome !== 'ok' || !use.line.includes('箱里:')) return;
    this.seen.set(`${dimension}:${target}`, now);
    for (const [key, at] of this.seen) {
      if (now - at >= INSPECTION_COOLDOWN_MS) this.seen.delete(key);
    }
  }
}
