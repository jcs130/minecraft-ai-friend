export const STATE_TOOL = {
  name: 'mc_tangerine', tags: ['read'],
  description: 'Read this connection\'s 橘乡 (mc.tangerinecology.top) route phase (limbo/lobby/main), the /main hop and SVC gate, '
    + 'recent teleport requests with their accept/deny commands, teleport warm-up, recent TrChat player lines and resource-pack state; '
    + 'or the server guide / plugin list. Read only: sends no command and does not move the body. Absent values are unknown.',
  parameters: { type: 'object', additionalProperties: false, properties: { action: { enum: ['state', 'guide', 'plugins'] } } },
};

/** Observed 2026-11-23 (Asia/Shanghai) from /version, /help and command completion; `/pl` is denied to players. */
export const PLUGINS = Object.freeze([
  { name: 'Velocity 1.7.2-26.2', role: '代理；NanoLimbo 认证 → lobby → /main 生存服', agent: 'core 26.2 实验栈 + 本扩展路线' },
  { name: 'Lophine/Purpur 26.2', role: '后端服务端（Paper 分支）', agent: 'core' },
  { name: 'MaxAuth', role: '离线账号登录 /login', agent: 'core server-login（凭据仅运行时环境变量）' },
  { name: 'Vulcan 2.9.7', role: '反作弊', agent: '本扩展：不疾跑/不跑酷/寻路不挖不垫；警告即停' },
  { name: 'Simple Voice Chat 2.6.20 + voicechatproxy', role: '近距离语音（经代理，voiceHost 为域名）', agent: 'core mc_svc；本扩展在 /main 后才放行' },
  { name: 'CraftEngine 26.9.2', role: '自定义物品/方块/字形（强制资源包）', agent: 'core MUTF-8/组件证据；本扩展接受资源包并剥离图标字形' },
  { name: 'CustomNameplates', role: '名牌、气泡字形', agent: '本扩展剥离私用区字形' },
  { name: 'TrChat 2.4.9', role: '聊天格式（name >>> 消息，多层嵌套组件）', agent: 'core 深嵌套；本扩展解析发送者' },
  { name: 'HuskHomes', role: 'tpa/tpaccept/tpdeny、home、warp、spawn、rtp（传送前 3 秒预热）', agent: '本扩展解析请求与可点击接受按钮' },
  { name: 'CMI / CMILib', role: '杂项命令（cmi:rtp 等）', agent: '仅命令；未适配菜单' },
  { name: 'TrMenu / KaMenu', role: 'GUI 菜单', agent: 'core mc_window 读格；未逐菜单适配' },
  { name: 'Residence', role: '领地保护', agent: '未适配：领地内破坏/放置会被拒绝' },
  { name: 'AuraSkills', role: 'RPG 技能（skills/mana）', agent: '未适配' },
  { name: 'XConomy / PlayerPoints / QuickShop / ChestShop / GlobalMarket', role: '经济与商店', agent: '不自动消费' },
  { name: 'PlayerGuild / LiteSignIn / CookieClickerZ / BreweryX / 钓鱼 / 抽奖等', role: '玩法插件（四十余个）', agent: '未适配' },
]);

export const KNOWN_ISSUES = Object.freeze([
  '26.2 实验栈：多格合成（如木棍）偶发窗口不同步，合成结果需按背包实际变化核对。',
  '复活后偶尔卡在高空玻璃平台（出生点结构），需人工路线或 /spawn。',
  'SVC 只验证了发送：UDP 认证、发包成功，玩家在聊天回复“听见了”；收音时只收到 keepalive，没有音频帧（原因未查清）。',
  '浮空提示字（text_display）、TrMenu/KaMenu 菜单、Residence 禁区尚无专用适配。',
]);

export const GUIDE = `橘乡（mc.tangerinecology.top，Velocity 26.2）：
入服路线：NanoLimbo 中 MaxAuth 要求 /login（核心按配置一次提交，凭据只来自运行时环境变量）→ 大厅 → 扩展自动发送一次 /main（失败最多重试 3 次）→ 生存服。大厅里没有生存玩法，mc_tangerine state 的 phase=main 才算进服。
反作弊 Vulcan：不疾跑、不跑酷、寻路不挖不垫；挖掘按核心限速。收到警告后自动寻路停止，不要绕过。
语音：Simple Voice Chat 经 voicechatproxy，只有 phase=main 后 mc_svc 才握手；sent 只表示 UDP 已发出，不代表有人听见。mc_voice（mcagent:voice）在此服不可用。
传送：HuskHomes。别人发来请求时 mc_tangerine state 给出 accept/deny 原命令，是否接受由你决定，用 mc_do 的 chat 步骤发送；预热 3 秒内不要移动。
聊天：TrChat 公屏格式 “名字 >>> 内容”；“插件名 >>> …”是系统通知。图标字形已剥离。
领地（Residence）内不能破坏/放置；经济、商店、抽奖不要自动消费。被问是否是 AI 时如实回答。
`;
