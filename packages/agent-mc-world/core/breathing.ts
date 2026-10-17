/** Public, timestamped observations for agent-authored diving programs; no action policy. */
import type { Bot } from 'mineflayer';
import { WATER_BLOCKS } from './fluid-blocks.ts';

const sensors = new WeakMap<Bot, { oxygenAt: string | null; healthAt: string | null;
  lastHealth: number | null; healthLoss: number; healthRecovered: number; epoch: number; dispose(): void }>();

/** Attach once per connection, before the first server oxygen/health updates. */
export function installBreathingReadings(bot: Bot): () => void {
  const current = sensors.get(bot);
  if (current) return current.dispose;
  const sensor = { oxygenAt: null as string | null, healthAt: null as string | null,
    lastHealth: Number.isFinite(bot.health) ? bot.health : null, healthLoss: 0, healthRecovered: 0, epoch: 0, dispose: () => {} };
  const breath = () => { sensor.oxygenAt = new Date().toISOString(); };
  const health = () => {
    sensor.healthAt = new Date().toISOString();
    if (Number.isFinite(bot.health)) {
      if (sensor.lastHealth !== null) {
        sensor.healthLoss += Math.max(0, sensor.lastHealth - bot.health);
        sensor.healthRecovered += Math.max(0, bot.health - sensor.lastHealth);
      }
      sensor.lastHealth = bot.health;
    } else sensor.lastHealth = null;
  };
  const reset = () => {
    sensor.oxygenAt = null; sensor.healthAt = null; sensor.lastHealth = null;
    sensor.healthLoss = 0; sensor.healthRecovered = 0; sensor.epoch++;
  };
  sensor.dispose = () => {
    bot.off('breath', breath); bot.off('health', health); bot.off('respawn', reset); bot.off('end', sensor.dispose);
    if (sensors.get(bot) === sensor) sensors.delete(bot);
  };
  bot.on('breath', breath); bot.on('health', health); bot.on('respawn', reset); bot.on('end', sensor.dispose);
  sensors.set(bot, sensor);
  return sensor.dispose;
}

export function breathingReadout(bot: Bot) {
  installBreathingReadings(bot);
  const position = bot.entity?.position, velocity = bot.entity?.velocity;
  const feet = position ? bot.blockAt(position, false) : null;
  const head = position ? bot.blockAt(position.offset(0, 1, 0), false) : null;
  const wet = (block: typeof feet): boolean | null => block
    ? WATER_BLOCKS.has(block.name) || block.isWaterlogged === true : null;
  const feetWet = wet(feet), headWet = wet(head);
  const raw = typeof bot.oxygenLevel === 'number' && Number.isFinite(bot.oxygenLevel) ? bot.oxygenLevel : null;
  const xyz = (p: typeof position) => p ? { x: p.x, y: p.y, z: p.z } : null;
  return { sampledAt: new Date().toISOString(), source: 'mineflayer-client-observation' as const,
    dimension: String(bot.game?.dimension ?? 'unknown'), entityId: bot.entity?.id ?? null,
    oxygen: raw !== null && raw >= 0 && raw <= 20 ? raw : null, oxygenRaw: raw,
    oxygenUpdatedAt: sensors.get(bot)?.oxygenAt ?? null,
    health: typeof bot.health === 'number' && Number.isFinite(bot.health) ? bot.health : null,
    healthUpdatedAt: sensors.get(bot)?.healthAt ?? null,
    observationEpoch: sensors.get(bot)?.epoch ?? null,
    healthLoss: sensors.get(bot)?.healthLoss ?? null, healthRecovered: sensors.get(bot)?.healthRecovered ?? null,
    headWet, bodyWet: feetWet === true || headWet === true ? true : feetWet === null || headWet === null ? null : false,
    position: xyz(position), velocity: xyz(velocity) };
}
