import { describe, expect, it, vi } from 'vitest';
import { beginViewerInteraction, clearViewerInteraction, finishViewerInteraction, onViewerInteraction, viewerInteraction } from '../core/viewer-interaction.ts';

describe('viewer interaction lifetime', () => {
  it('shows only the current player operation and clears it on movement or expiry', () => {
    vi.useFakeTimers();
    try {
      const bot = { entity: { position: { x: 1, y: 2, z: 3 } } };
      const other = { entity: { position: { x: 1, y: 2, z: 3 } } };
      const seen = vi.fn();
      const detach = onViewerInteraction(bot, seen);
      const book = beginViewerInteraction(bot, { kind: 'book-read', title: '引导书', author: '作者',
        page: 2, pageCount: 4, text: '正文' });
      expect(viewerInteraction(bot)).toMatchObject({ id: book, phase: 'active', page: 2 });
      expect(viewerInteraction(other)).toBeNull();
      const change = beginViewerInteraction(bot, { kind: 'rename', title: '铁砧', item: '命名牌', name: '小鱼' });
      finishViewerInteraction(bot, book, 'confirmed');
      expect(viewerInteraction(bot)).toMatchObject({ id: change, phase: 'active', name: '小鱼' });
      finishViewerInteraction(bot, change, 'confirmed', '小鱼');
      finishViewerInteraction(bot, change, 'unconfirmed');
      expect(viewerInteraction(bot)).toMatchObject({ phase: 'confirmed', result: '小鱼' });
      vi.advanceTimersByTime(2301);
      expect(viewerInteraction(bot)).toBeNull();
      beginViewerInteraction(bot, { kind: 'sign-write', title: '告示牌', side: 'front', lines: ['往北'] });
      bot.entity.position.x += 2;
      expect(viewerInteraction(bot)).toBeNull();
      detach();
      expect(seen).toHaveBeenCalledTimes(4);
      beginViewerInteraction(bot, { kind: 'book-read', title: '书', page: 1, pageCount: 1, text: '正文' });
      clearViewerInteraction(bot, 'book-read');
      expect(viewerInteraction(bot)).toBeNull();
      expect(seen).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
