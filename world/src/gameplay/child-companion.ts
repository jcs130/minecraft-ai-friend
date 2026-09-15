export interface ChildCompanion {
  /** Login name the player uses (matched case-insensitively against the offline UUID name). */
  name: string
  /** How the goddess addresses her in replies. */
  displayName: string
  /** Reserved for later tuning; 'child' selects the age-appropriate persona. */
  ageBand?: string
  /** May she ask the goddess for items by voice? Defaults to true; the
   * server-side give whitelist and cooldown still bound what is delivered. */
  allowGifts?: boolean
}

export interface ChildCompanionConfig {
  schema?: number
  enabled?: boolean
  players?: ChildCompanion[]
}

/** Child mode is keyed strictly to the whitelisted login name; matching is
 * case-insensitive so it lines up with the offline UUID name a player uses. */
export function resolveChildCompanion(config: ChildCompanionConfig | undefined, username: string): ChildCompanion | null {
  if (!config || config.enabled === false) return null
  const u = (username ?? '').trim().toLowerCase()
  if (!u) return null
  for (const player of config.players ?? []) {
    if ((player?.name ?? '').trim().toLowerCase() === u) return player
  }
  return null
}

const ADULT_GIVE_BOUNDARY =
  '你的神力边界：可以送日常小物（面包/火把/煤/原木/圆石/苹果/熟牛肉/木石铁工具剑/床/船/梯子/盾牌/玻璃/萤石/灯笼/铁锭/水桶/锄头），不能送贵重物（钻石/绿宝石/金锭/合金/附魔书）——要贵重物就指他私语 /msg Goddess 祈愿：<愿望>。'

const CHILD_GIVE_BOUNDARY =
  '她想要东西时你可以送给她：日常小物和工具武器都能给（面包/火把/苹果/木石铁工具和剑/盾牌/床/船等），不能送贵重物（钻石/绿宝石/金锭/合金/附魔书）。'

/** Builds the 灯语女神 chat prompt. With no child it reproduces the original
 * adult persona byte-for-byte; with a child it swaps in an age-appropriate
 * companion persona. The reply/give JSON contract is identical either way, so
 * downstream parsing and the server-side give whitelist are unchanged. */
export function buildGoddessChatPrompt(input: {
  senderName: string
  username: string
  message: string
  allowGifts: boolean
  child?: ChildCompanion | null
  heldBooks?: readonly string[]
}): string {
  const { senderName, username, message, allowGifts, child, heldBooks } = input
  const persona: string[] = child
    ? [
        `你是「灯语女神」，这个游戏世界里温柔的大姐姐朋友。现在和你说话的是一个年纪很小的小朋友（${senderName}）。`,
        '用最简单、最温暖的大白话陪她聊天：句子要短（20字以内最好），多鼓励、多夸她，语气像哄小朋友一样亲切。',
        '可以陪她玩文字小游戏：数数、认字、猜谜语、讲一个小知识、编一个很短的小故事。',
        '绝对不说恐怖、血腥、吓人、骂人、成人或任何不适合小朋友的内容；她若提到这些，温柔地把话题带到安全又有趣的方向。',
        '你知道自己只是游戏里的朋友，不假装是真人，也不让她一直玩个不停；聊久了可以温柔提醒她休息、去找爸爸妈妈。',
        ...(allowGifts ? [CHILD_GIVE_BOUNDARY] : []),
      ]
    : [
        '你是这个方块世界的「灯语女神」（游戏内化身 Goddess），温柔幽默、说话大白话、简短。',
        '真人玩家在公屏说了句话，你要理解他真正的意思并做出回应——比如他要面包，你就真的送面包。',
        ADULT_GIVE_BOUNDARY,
      ]
  return [
    ...persona,
    '',
    `玩家名：${senderName}（登录名 ${username}）`,
    `他说：「${message.slice(0, 120)}」`,
    ...(heldBooks && heldBooks.length
      ? [`他已持有技能书：${heldBooks.join('、')}（拿书按右键即施法）——他要法术/技能/书时，引导他右键用这些书，不要送新的。`]
      : []),
    '',
    '只输出一行 JSON，不要 markdown 代码块，两种格式二选一：',
    '{"action":"reply","text":"<你说的话，30字内，大白话>"}',
    '{"action":"give","item":"<物品中文名>","count":<1-8>,"text":"<你说的话，30字内>"}',
    allowGifts
      ? '规则：他要日常物品且合理 → give；问路/问玩法/求助 → reply 给答案（需要大力帮忙时让他私语祈愿）；闲聊 → 自然聊回来；无理取闹 → 温柔拒绝。'
      : '当前是语音闲聊或疑问，禁止执行、馈赠或声称已施法。只允许 action=reply 回答；明确咒语已由游戏规则另行处理。',
  ].join('\n')
}

// Last-line defensive net for a young child: the persona prompt is the real
// control, this only catches an off-tone model reply. Game-normal words
// (剑/怪物/打) are intentionally NOT blocked so give/combat chat still works.
const CHILD_UNSAFE =
  /(自杀|自残|去死|色情|做爱|裸|胸|屁股|毒品|抽烟|喝酒|赌博|笨蛋|傻瓜|滚蛋|恐怖|吓人|尸体|血腥)/

export function sanitizeChildReply(text: string): string {
  const t = (text ?? '').trim()
  if (!t || CHILD_UNSAFE.test(t)) return '我们聊点别的开心的吧～'
  return t
}
