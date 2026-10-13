/** Bounded visual facts taken from 1.20.6 clientbound packets and viewer messages. */
export interface ViewerPoint { x: number; y: number; z: number }

export interface ViewerParticle {
  kind: 'particle'; name: string; position: ViewerPoint;
  spread: ViewerPoint; speed: number; count: number; color?: [number, number, number];
}

export interface ViewerExplosion {
  kind: 'explosion'; position: ViewerPoint; radius: number;
}

export interface ViewerWorldEvent {
  kind: 'world_event'; position: ViewerPoint; effectId: number; data: number;
  blockName?: string;
  itemName?: string;
}

export interface ViewerBiomeClimate {
  hasPrecipitation?: boolean;
  temperature?: number;
  precipitation?: 'rain' | 'snow' | 'none';
}

export function viewerBiomeClimate(value: unknown): ViewerBiomeClimate {
  if (!value || typeof value !== 'object') return {};
  const biome = value as Record<string, unknown>;
  const precipitation = biome.precipitation;
  const hasPrecipitation = biome.has_precipitation ?? biome.hasPrecipitation;
  return {
    ...(typeof hasPrecipitation === 'boolean' ? { hasPrecipitation } : {}),
    ...(typeof biome.temperature === 'number' && Number.isFinite(biome.temperature)
      ? { temperature: biome.temperature } : {}),
    ...(precipitation === 'rain' || precipitation === 'snow' || precipitation === 'none'
      ? { precipitation } : {}),
  };
}

export interface ViewerCustomEvent {
  kind: 'skill' | 'quest' | 'notice' | 'combat' | 'environment' | 'achievement';
  id: string; title: string; body: string;
  tone: 'positive' | 'neutral' | 'warning' | 'danger' | 'arcane' | 'healing' | 'frost' | 'fire' | 'movement';
  position?: ViewerPoint;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const point = (x: unknown, y: unknown, z: unknown): ViewerPoint | null =>
  finite(x) && finite(y) && finite(z) && [x, y, z].every((value) => Math.abs(value) <= 30_000_000)
    ? { x, y, z } : null;

export function viewerParticle(packet: unknown): ViewerParticle | null {
  if (!packet || typeof packet !== 'object') return null;
  const row = packet as Record<string, unknown>;
  const position = point(row.x, row.y, row.z);
  const spread = point(row.offsetX, row.offsetY, row.offsetZ);
  const particle = row.particle as Record<string, unknown> | null;
  const name = typeof particle?.type === 'string' ? particle.type.replace(/^minecraft:/, '') : '';
  if (!position || !spread || !/^[a-z0-9_]{1,64}$/.test(name) || !finite(row.amount) ||
      !finite(row.velocityOffset)) return null;
  const data = particle?.data as Record<string, unknown> | null;
  const color = data && [data.red, data.green, data.blue].every(finite)
    ? [data.red, data.green, data.blue].map((value) => Math.max(0, Math.min(1, value as number))) as [number, number, number]
    : undefined;
  return { kind: 'particle', name, position,
    spread: { x: Math.min(Math.abs(spread.x), 8), y: Math.min(Math.abs(spread.y), 8), z: Math.min(Math.abs(spread.z), 8) },
    speed: Math.min(Math.abs(row.velocityOffset), 3), count: Math.min(48, Math.max(1, Math.trunc(row.amount))),
    ...(color ? { color } : {}) };
}

export function viewerExplosion(packet: unknown): ViewerExplosion | null {
  if (!packet || typeof packet !== 'object') return null;
  const row = packet as Record<string, unknown>;
  const position = point(row.x, row.y, row.z);
  return position && finite(row.radius)
    ? { kind: 'explosion', position, radius: Math.min(12, Math.max(0.5, Math.abs(row.radius))) } : null;
}

export function viewerWorldEvent(packet: unknown, registry?: {
  blocksByStateId?: Record<number, { name?: string }>;
  items?: Record<number, { name?: string }>;
}): ViewerWorldEvent | null {
  if (!packet || typeof packet !== 'object') return null;
  const row = packet as Record<string, unknown>;
  const location = row.location as Record<string, unknown> | null;
  const position = location && point(location.x, location.y, location.z);
  if (!position || !Number.isInteger(row.effectId) || !Number.isInteger(row.data)) return null;
  const blockName = row.effectId === 2001 ? registry?.blocksByStateId?.[Number(row.data)]?.name : undefined;
  const itemName = row.effectId === 1010 && Number(row.data) > 0
    ? registry?.items?.[Number(row.data)]?.name : undefined;
  const resourceName = (value: unknown): value is string => typeof value === 'string' &&
    /^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]{1,96}$/.test(value);
  return { kind: 'world_event', position, effectId: row.effectId as number, data: row.data as number,
    ...(resourceName(blockName) ? { blockName } : {}), ...(resourceName(itemName) ? { itemName } : {}) };
}

/** Audit lane for clientbound packets. Unmapped names stay visible in /viewer-coverage. */
export function viewerPacketLane(name: string): 'presentation' | 'world' | 'entity' | 'hud' | 'message' | 'plugin' | 'control' | 'unmapped' {
  if (name === 'custom_payload') return 'plugin';
  if (['world_particles', 'explosion', 'world_event', 'collect', 'entity_effect', 'remove_entity_effect',
    'set_cooldown', 'advancements', 'sound_effect', 'named_sound_effect', 'entity_sound_effect', 'stop_sound'].includes(name))
    return 'presentation';
  if (['map_chunk', 'unload_chunk', 'block_change', 'multi_block_change', 'update_light',
    'tile_entity_data', 'block_action', 'chunk_biomes'].includes(name)) return 'world';
  if (/^(?:spawn_|entity_|rel_entity_move$|named_entity_spawn$|player_info$)/.test(name) ||
      ['damage_event', 'animation', 'teams'].includes(name)) return 'entity';
  if (['update_health', 'set_slot', 'window_items', 'open_window', 'close_window',
    'craft_progress_bar', 'game_state_change', 'update_time', 'experience', 'boss_bar', 'action_bar',
    'title', 'title_times', 'clear_titles', 'scoreboard_objective', 'scoreboard_score',
    'scoreboard_display_objective'].includes(name)) return 'hud';
  if (['system_chat', 'player_chat', 'disguised_chat', 'chat'].includes(name)) return 'message';
  if (['keep_alive', 'bundle_delimiter', 'declare_commands', 'acknowledge_player_digging',
    'ping', 'abilities', 'login', 'respawn', 'declare_recipes', 'tags', 'update_enabled_features',
    'position', 'update_view_position', 'update_view_distance', 'simulation_distance',
    'initialize_world_border', 'set_ticking_state', 'step_tick'].includes(name))
    return 'control';
  return 'unmapped';
}
