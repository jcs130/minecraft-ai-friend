/** Completion notices from the vanilla 1.20.6 advancement stream. */
export interface ViewerAdvancement {
  key: string; title: string; description: string; frame: 'task' | 'goal' | 'challenge';
}

interface Definition extends ViewerAdvancement { requirements: string[][]; showToast: boolean }

export class ViewerAdvancementTracker {
  private readonly definitions = new Map<string, Definition>();
  private readonly completed = new Set<string>();
  private initialized = false;

  ingest(packet: unknown, text: (value: unknown) => string): ViewerAdvancement[] {
    if (!packet || typeof packet !== 'object') return [];
    const row = packet as Record<string, unknown>;
    if (row.reset === true) { this.definitions.clear(); this.completed.clear(); this.initialized = false; }
    for (const key of Array.isArray(row.identifiers) ? row.identifiers.slice(0, 256) : []) {
      if (typeof key === 'string') { this.definitions.delete(key); this.completed.delete(key); }
    }
    for (const entry of Array.isArray(row.advancementMapping) ? row.advancementMapping.slice(0, 256) : []) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      const value = item.value as Record<string, unknown> | null;
      const display = value?.displayData as Record<string, unknown> | null;
      if (typeof item.key !== 'string' || item.key.length > 160 || !display) continue;
      const requirements = Array.isArray(value?.requirements)
        ? value.requirements.filter((group): group is string[] => Array.isArray(group) && group.every((part) => typeof part === 'string')).slice(0, 64)
        : [];
      const flags = display.flags as Record<string, unknown> | null;
      const frame = display.frameType === 2 ? 'challenge' : display.frameType === 1 ? 'goal' : 'task';
      this.definitions.set(item.key, { key: item.key, title: text(display.title).slice(0, 80),
        description: text(display.description).slice(0, 160), frame, requirements,
        showToast: flags?.show_toast === 1 || flags?.show_toast === true });
    }
    const notices: ViewerAdvancement[] = [];
    for (const entry of Array.isArray(row.progressMapping) ? row.progressMapping.slice(0, 256) : []) {
      if (!entry || typeof entry !== 'object') continue;
      const progress = entry as Record<string, unknown>;
      if (typeof progress.key !== 'string' || !Array.isArray(progress.value)) continue;
      const definition = this.definitions.get(progress.key);
      if (!definition || !definition.requirements.length) continue;
      const granted = new Set(progress.value.filter((item) => item && typeof item === 'object' &&
        (item as Record<string, unknown>).criterionProgress != null)
        .map((item) => (item as Record<string, unknown>).criterionIdentifier));
      const done = definition.requirements.every((group) => group.some((criterion) => granted.has(criterion)));
      if (!done) { this.completed.delete(progress.key); continue; }
      if (!this.completed.has(progress.key) && this.initialized && definition.showToast && definition.title)
        notices.push({ key: definition.key, title: definition.title,
          description: definition.description, frame: definition.frame });
      this.completed.add(progress.key);
    }
    this.initialized = true;
    return notices.slice(0, 8);
  }
}
