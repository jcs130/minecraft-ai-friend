import { expect, it, vi } from 'vitest';
import mineflayer from 'mineflayer';
import { Bridge } from '../core/bridge.ts';

class DefaultTransport extends Bridge {
  open(options: mineflayer.BotOptions) { return this.createBot(options); }
}
it('passes exact connection options through the default public transport', () => {
  const body = {} as mineflayer.Bot;
  const create = vi.spyOn(mineflayer, 'createBot').mockReturnValue(body);
  try {
    const bridge = Object.create(DefaultTransport.prototype) as DefaultTransport;
    const options = { host: 'test.invalid', port: 25565, username: 'Fixture', version: '1.20.1', respawn: false };
    expect(bridge.open(options)).toBe(body);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(options);
  } finally { create.mockRestore(); }
});
it('allows an explicit extension to replace transport without a second default connection', () => {
  const body = {} as mineflayer.Bot;
  class ForgeTransport extends DefaultTransport {
    protected createBot(options: mineflayer.BotOptions) {
      expect(options.version).toBe('1.20.1');
      return body;
    }
  }
  const create = vi.spyOn(mineflayer, 'createBot');
  try {
    const bridge = Object.create(ForgeTransport.prototype) as ForgeTransport;
    expect(bridge.open({ username: 'Fixture', version: '1.20.1' })).toBe(body);
    expect(create).not.toHaveBeenCalled();
  } finally { create.mockRestore(); }
});
