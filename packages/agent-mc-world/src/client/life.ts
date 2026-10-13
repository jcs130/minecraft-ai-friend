import type { ToolDef } from './contracts.ts';

/** Authored possibilities, not a scheduler, personal memory or fabricated experience. */
const STORIES = [
  { id: 'forge', title: '给下一次出门打造装备', start: '先看装备耐久、库存、配方与许可；已有合用装备可结束。',
    stages: ['选一件确实需要的装备，记材料差额', '按可见矿脉和许可只采缺料', '冶炼、制作并装备', '自然使用后复核效果'],
    proof: '物品实际入包并装备；测试效果另记。', wait: '冶炼在后台等；不每次重做整套补给。' },
  { id: 'harvest', title: '把一片田变成稳定的饭桌', start: '确认合法耕地、水源、种子和现有食物；够用可不扩田。',
    stages: ['选小片田并记录成熟度', '只收成熟作物，按种子数补种', '按核实配方做食物', '自然路过时回访生长和消耗'],
    proof: '成熟作物减少、食物净增、补种实际出现分别验收。', wait: '未熟登记回访条件，继续生活；不原地反复右键。' },
  { id: 'expedition', title: '沿一条新路认识世界', start: '选已知线索或可见方向，明确折返条件与返程线索。',
    stages: ['定一个想弄清的探索问题', '比较实测路线，分段推进记地标', '观察一处结构、景观或资源', '记实际发现并决定返程或下一段'],
    proof: '真实抵达、新增可见区域或测得地标；失败不证明整片不可达。', wait: '危险或天黑可暂缓分支；未见地形保持未知。' },
  { id: 'home', title: '给家添一处好用的地方', start: '明确需求、归属和许可；现有设施够用就不重复建。',
    stages: ['观察用途与场地，画小蓝图', '只补蓝图缺料', '逐段施工核对方块与净空', '实际使用并修正不便'],
    proof: '目标格一致且功能能用；搬物品不是施工进度。', wait: '缺许可时暂缓，不反复试放。' },
  { id: 'visit', title: '带一份小礼物去拜访', start: '对方愿意互动；在线不等于附近或队友，优先用已有物品。',
    stages: ['回应真实请求或问候', '确认双方可见且相距2–4格', 'toss target点名，或经允许用共同容器', '核对领取回执与回应'],
    proof: '抛出不是送达；领取未知不重投补发。', wait: '对方未回应就后台等待，自己的生活继续。' },
] as const;

export function minecraftLifeTool(): ToolDef {
  return { name: 'mc_life', tags: ['read'], description: '按需读取通用Minecraft生活故事线；省略id给简短索引。供Agent选择和改写，不自动换目标。',
    parameters: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', enum: STORIES.map(s => s.id) } } },
    handler: async args => {
      if (args.id === undefined) return JSON.stringify({ author: '维护者通用资料', stories: STORIES.map(({ id, title }) => ({ id, title })),
        next: '按当前意向读一条，可改写；有用任务继续，不强制轮换。' });
      const story = STORIES.find(s => s.id === args.id);
      return story ? JSON.stringify({ author: '维护者通用资料；非亲历记忆', ...story,
        save: '采用后由宿主保存同一目标、当前阶段、完成证据、下一条件、方法版本和失败边界；交接后恢复，复用前读回证据。' })
        : { failed: true, text: '故事线不存在；省略id查看索引。' };
    } };
}
