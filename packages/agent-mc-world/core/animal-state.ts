/** 动物状态读取仅使用协议 registry 的元数据字段。 */
import { minecraftTextComponent } from './text-component.ts';

export interface NamedStack { name?: string }

export interface FactEntity {
  id?: number;
  name?: string;
  metadata?: unknown[];
}

export interface FactBot {
  entity?: { uuid?: string } | null;
  /** 登录时玩家 UUID 优先取 bot.player，其次取实体或协议客户端。 */
  player?: { uuid?: string } | null;
  _client?: { uuid?: string } | null;
  inventory?: { slots?: Array<NamedStack | null | undefined> };
  registry?: {
    entitiesByName?: Record<string, { metadataKeys?: string[]; type?: string } | undefined>;
  };
}

export function metaOf(bot: FactBot, entity: FactEntity, key: string): unknown {
  const name = entity.name;
  if (!name) return undefined;
  const keys = bot.registry?.entitiesByName?.[name]?.metadataKeys ?? [];
  const at = keys.indexOf(key);
  return at >= 0 ? entity.metadata?.[at] : undefined;
}

/** 可驯服实体与对应道具。消耗道具只能证明使用发生，驯服结果须读取主人元数据。 */
export const TAME_ITEMS: Readonly<Record<string, readonly string[]>> = {
  wolf: ['bone'],
  cat: ['cod', 'salmon'],
  parrot: ['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds', 'torchflower_seeds', 'pitcher_pod'],
};

/** 信任交互不产生宠物主人；结果读取 trusting 元数据。 */
export const TRUST_ITEMS: Readonly<Record<string, readonly string[]>> = {
  ocelot: ['cod', 'salmon'],
};

/** 原版 1.20.6 的喂养食物；接受食物不证明进入繁殖状态或幼体出生。 */
export const FEED_ITEMS: Readonly<Record<string, readonly string[]>> = {
  cow: ['wheat'],
  mooshroom: ['wheat'],
  sheep: ['wheat'],
  goat: ['wheat'],
  pig: ['carrot', 'potato', 'beetroot'],
  rabbit: ['carrot', 'golden_carrot', 'dandelion'],
  chicken: ['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds', 'torchflower_seeds', 'pitcher_pod'],
  wolf: ['beef', 'porkchop', 'chicken', 'mutton', 'rabbit', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'cooked_rabbit', 'rotten_flesh'],
  cat: ['cod', 'salmon'],
  ocelot: ['cod', 'salmon'],
  horse: ['wheat', 'sugar', 'hay_block', 'apple', 'golden_carrot', 'golden_apple', 'enchanted_golden_apple'],
  donkey: ['wheat', 'sugar', 'hay_block', 'apple', 'golden_carrot', 'golden_apple', 'enchanted_golden_apple'],
  mule: ['wheat', 'sugar', 'hay_block', 'apple', 'golden_carrot', 'golden_apple', 'enchanted_golden_apple'],
  llama: ['hay_block'],
  armadillo: ['spider_eye'],
  panda: ['bamboo'],
  turtle: ['seagrass'],
  fox: ['sweet_berries', 'glow_berries'],
  bee: ['dandelion', 'poppy', 'sunflower'],
  frog: ['slime_ball'],
  sniffer: ['torchflower_seeds'],
  camel: ['cactus'],
  strider: ['warped_fungus'],
  hoglin: ['crimson_fungus'],
  axolotl: ['tropical_fish_bucket'],
};

/** 这只活物现在的主人 UUID;没被驯服/读不到元数据返回 null。 */
export function readTamedBy(bot: FactBot, entity: FactEntity): string | null {
  const raw = metaOf(bot, entity, 'owneruuid');
  // 协议把"没有主人"编成缺席的 optional;不同版本的 protodef 分别给 undefined/null/''
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'string') return raw;
  // OptionalUUID 有时解成 { present, value } 或者裸的 UUID 对象
  const obj = raw as { value?: unknown; present?: unknown };
  if (obj.present === false) return null;
  const inner = obj.value ?? raw;
  return typeof inner === 'string' && inner !== '' ? inner : null;
}

/**
 * 主人 UUID 与当前玩家一致时返回 true；缺少任一身份时返回 false。
 * 登录阶段 bot.entity.uuid 可能缺失，优先使用 bot.player.uuid，并保留实体与协议客户端来源。
 */
export function tamedByMe(bot: FactBot, entity: FactEntity): boolean {
  const owner = readTamedBy(bot, entity);
  const me = bot.player?.uuid ?? bot.entity?.uuid ?? bot._client?.uuid;
  return owner !== null && typeof me === 'string' && me !== '' && owner === me;
}

/** TamableAnimal flags 的 0x01 位表示坐下；缺少该字段时返回 null。 */
export function readSitting(bot: FactBot, entity: FactEntity): boolean | null {
  const raw = metaOf(bot, entity, 'flags');
  if (typeof raw !== 'number') return null;
  return (raw & 0x01) !== 0;
}

/** 猪和炽足兽读取 saddle；马科与骆驼读取 flags 的 0x04 位。字段不可用时返回 null。 */
export function readSaddled(bot: FactBot, entity: FactEntity): boolean | null {
  const direct = metaOf(bot, entity, 'saddle');
  if (typeof direct === 'boolean') return direct;
  if (typeof direct === 'number') return direct !== 0;
  if (entity.name === 'horse' || entity.name === 'donkey' || entity.name === 'mule' || entity.name === 'camel') {
    const flags = metaOf(bot, entity, 'flags');
    return typeof flags === 'number' ? (flags & 0x04) !== 0 : null;
  }
  return null;
}

/** 马科的「驯服」位:'flags' 的 0x02。不是马科或读不到返回 null。 */
export function readHorseTamed(bot: FactBot, entity: FactEntity): boolean | null {
  if (entity.name !== 'horse' && entity.name !== 'donkey' && entity.name !== 'mule') return null;
  const flags = metaOf(bot, entity, 'flags');
  return typeof flags === 'number' ? (flags & 0x02) !== 0 : null;
}

export function readTrusting(bot: FactBot, entity: FactEntity): boolean | null {
  const raw = metaOf(bot, entity, 'trusting');
  return typeof raw === 'boolean' ? raw : null;
}

/** 可见动物与已选交互目标的当前读数；缺失字段省略，血量不推算上限或繁殖状态。 */
export function animalStateNote(bot: FactBot, entity: FactEntity): string {
  const name = entity.name ?? '';
  const type = bot.registry?.entitiesByName?.[name]?.type;
  const animal = type === undefined
    ? TAME_ITEMS[name] !== undefined || TRUST_ITEMS[name] !== undefined || FEED_ITEMS[name] !== undefined
      || name === 'mule' || name === 'trader_llama' || name === 'skeleton_horse' || name === 'zombie_horse'
    : type === 'animal' || type === 'water_creature' || type === 'ambient';
  if (!animal) return '';
  const notes: string[] = [];
  if (Number.isInteger(entity.id)) notes.push(`entityId=${entity.id}`);
  const customName = minecraftTextComponent(metaOf(bot, entity, 'custom_name'));
  if (customName) notes.push(`名字「${customName}」`);
  const baby = metaOf(bot, entity, 'baby');
  if (typeof baby === 'boolean') notes.push(baby ? '幼体' : '成年');
  const health = metaOf(bot, entity, 'health');
  if (typeof health === 'number' && Number.isFinite(health)) notes.push(`生命 ${health}`);
  if (TAME_ITEMS[name] !== undefined) {
    const flags = metaOf(bot, entity, 'flags');
    if (typeof flags === 'number') notes.push((flags & 0x04) !== 0 ? '已驯服' : '未驯服');
    const owner = readTamedBy(bot, entity);
    if (owner !== null) {
      const me = bot.player?.uuid ?? bot.entity?.uuid ?? bot._client?.uuid;
      notes.push(me ? (owner === me ? '主人是你' : '主人是其他玩家') : `主人 UUID=${owner}`);
    }
    const sitting = readSitting(bot, entity);
    if (sitting !== null) notes.push(sitting ? '坐着' : '未坐下');
  }
  const horseTamed = readHorseTamed(bot, entity);
  if (horseTamed !== null) notes.push(horseTamed ? '已驯服' : '未驯服');
  const saddled = readSaddled(bot, entity);
  if (saddled !== null) notes.push(saddled ? '有鞍' : '无鞍');
  const trusting = readTrusting(bot, entity);
  if (trusting !== null) notes.push(trusting ? '已信任玩家' : '尚未信任玩家');
  return notes.join('，');
}
