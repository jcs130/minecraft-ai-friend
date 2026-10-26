import type { ConfigGroup } from './support/host-contract.ts';
import { GAME_MEMORY_DEFAULTS, GAME_MEMORY_CONFIG_SCHEMA } from './game-memory-service.ts';
import { COMBAT_EXECUTION_DEFAULTS } from './combat-decision-types.ts';
import { PHOTOGRAPHY_DEFAULTS } from './photo-image.ts';


export const MINECRAFT_DEFAULTS = {
  provider: 'mineflayer' as 'mineflayer' | 'java-client',
  javaClient: { expectedUuid: '', expectedServer: '', controllerId: '', credentialsFile: '', ledgerDir: '', leaseMs: 15000, viewerMode: 'auto', viewerPageFile: '', minescriptEnabled: false, actionWaitMs: 1000, methodWaitMs: 1000, stateDetail: 'summary', requireServerAuthorization: false, sharedReflexes: true } as import('../src/contracts/java-client.ts').JavaClientConfiguration,
  combatOptions: structuredClone(COMBAT_EXECUTION_DEFAULTS),
  // enabled 由Persona的装配层显式开启。
  enabled: false,
  /** 服务器地址(私服 dry-run 默认本机) */
  host: '127.0.0.1',
  port: 25565,
  /** 游戏内用户名(offline 模式直接生效) */
  username: '',
  auth: 'offline' as 'offline' | 'microsoft',
  profilesFolder: '',
  /** Private scoped account file; only encrypted credential references are read by the client. */
  loginConfigFile: '',
  /** Maximum gap between server keepalive packets; not an action retry budget. */
  keepAliveTimeoutMs: 60_000,
  chatDuplicateWindowMs: 120_000,
  deathRespawnDelayMs: 4000,
  perception: { mineralVision: false },
  skinModel: 'classic' as 'classic' | 'slim',
  /**
   * 全链路的版本约定:服务器(Paper)、观察者客户端(Fabric+SpectatorPlus)、
   * mineflayer 协议必须使用同一版本。主力优化和验收目标为原版 Java 1.21.1，
   * 需要 Java 21+；其他版本按实际连接及对应资源选择，不能沿用历史观察者限制。
   */
  version: '1.21.1',
  /** 网页画面端口(OBS 浏览器源 + 画面源之一);0=不开 */
  viewerPort: 0,
  /** 0 = unlimited audience connections; captures retain their independent lane. */
  viewerMaxSessions: 0,
  /** 现代画面资源包根目录；空 = 使用自带 prismarine-viewer */
  viewerAssetsDir: '',
  /** 网页画面中语音气泡显示的称呼；空 = 游戏内用户名 */
  viewerSpeakerName: '',
  metricsDashboardUrl: '',
  performanceBridge: {module:'',endpoint:''},
  remoteTextures: true,
  memory: { ...GAME_MEMORY_DEFAULTS },
  /** Omitted mc_visual.background follows this mode; explicit arguments take precedence. */
  visual: { background: false },
  photography: structuredClone(PHOTOGRAPHY_DEFAULTS),
  /** 普通玩家可用的脱困传送指令；空值沿用受管服务器的控制台传送。 */
  escapeCommand: '',
  /** 挂载面板启停的本地服务器(空 = 未配置,按钮会提示去配置) */
  local: {
    /** World 启动时拉起本地服务器并连接;运行中由挂载面板启停。 */
    startWithWorld: false,
    /** 含 server.jar 的目录 */
    serverDir: '',
    /** java 路径;空 = 自动(serverDir 邻近 jdk → PATH) */
    javaPath: '',
    /** 服务器 JVM 参数 */
    jvmArgs: '-Xms1G -Xmx2G',
    /**
     * 作弊权限:托管启动服务器前把她、摄像机、玩家三个名字补进 ops.json(4 级)。
     * 专用服没有单人存档那个「开作弊」开关,能不能下 /tp、/gamemode 全看这份名单。
     * 关掉则只按名单现状来(既不补也不删),名单本身在「权限与作弊」面板里改。
     */
    cheats: false,
  },
  world: {
    /** 世界变化节流 tick(秒) */
    tickSec: 8,
    /** 位移超过多少格才值得说 */
    moveThreshold: 12,
    /** 世界快照进上下文的最短间隔(秒)。快照是投递成文事件:搭车走,发车刻现拿 */
    snapshotSec: 10,
    /** 分段去重下强制发一次全量快照的间隔(秒),给增量流的基线兜底 */
    snapshotAnchorSec: 600,
  },
  /**
   * 寻路垫脚/搭路可用的方块,顺序即优先级。列表外的方块寻路器不会当垫脚用——
   * 圆石等兼作合成材料的方块,不想被路上消耗就从这里拿掉。
   */
  scaffoldBlocks: ['dirt', 'cobblestone'],
  /** 受理时报告前置试算的否定结果，出队时重查并阻断 hard；关闭后不执行这两次试算。 */
  precheck: true,
  /** Server permission queries are diagnostic by default; cached explicit denials still apply. */
  protectionPreflight: false,
  /** 受理回执附上相同任务的上次终态。 */
  priorOutcome: true,
  /** 反复成功任务的可选模型失效 fallback；只作用于列出的目标技能。 */
  repeatSuccessFallback: { enabled: false, skillsCsv: '', maxSuccesses: 3, windowMinutes: 15 },
  /** 空闲时授权的小动作；占用身体的任务与事件可随时取消。 */
  idle: {
    enabled: false,
    selector: 'random' as const,
    minIdleMs: 6_000,
    minIntervalMs: 12_000,
    maxIntervalMs: 28_000,
    afterArrival: false,
    allowMovement: false,
  },
  journey: {enabled:true,choiceMinBlocks:10,choiceMaxBlocks:20,dangerChoiceMaxBlocks:5},
  reflex: {
    /** 受击反击 */
    fightBack: true,
    /** 生命低于此值就脱离战斗;不还手也照样跑 */
    fleeHealth: 10,
    /** 两次受击反应的最短间隔 */
    reactCooldownSec: 8,
    antiDrown: true,
    /**
     * 挨烧就跑。这一条不能交给主脑:岩浆浇脸、蹭到流动岩浆柱都是环境自己找上门,
     * 20 血在岩浆里只够活两秒半,等她下一轮想明白再动人已经烧没了。挖掘绕开岩浆
     * 是预防,预防挡不住被浇的那种。
     */
    antiLava: true,
  },
  /**
   * 被打或敌对进入 engageRadius 时，按策略及血线决定交战；沿用 reflex.fleeHealth。
   * 战斗期间挂起任务，结束后从断点恢复，事件照常投递。关闭后受击交回反射层。
   */
  combat: {
    enabled: true,
    /** 触发半径:敌对贴到这么近才动手 */
    engageRadius: 3,
    /** 追击上限(格) */
    chaseMax: 6,
    /** E3 硬时长闸(秒):到点强制交还,防止刷怪笼/夜晚开阔地"永久失声" */
    maxSec: 30,
    /**
     * 理想间距(格)。僵尸有效攻击距离 p99=2.40、玩家上限 3.0,安全带宽约 0.6:
     * 2.88 几乎无敌(台架值),2.6 会偶尔挨打、看起来像个会玩的人——这是观感旋钮
     */
    space: 2.6,
    /** E4:5 分钟滑窗里战斗时长占比超过此百分数就强制冷却 */
    busyRatio: 60,
    /** E4 触发后多少秒内不自动进场 */
    cooldownSec: 60,
  },
  /** 观察者客户端:真客户端 + 观察者模式跟着 bot,支持光影/模组 */
  client: {
    enabled: false,
    /** .minecraft 目录 */
    gameDir: '',
    /** versions/ 下的版本 id;空 = 目录里唯一那个(装了 Fabric/Iris 就填那个整合版 id) */
    versionId: '',
    /**
     * java 路径;空 = PATH 上的 java。版本要与游戏对上:1.20.6 用 Java 21。
     * 更高的 JDK 会让游戏自带的 LWJGL 3.3.3 认不出 JNI 版本(启动日志里有
     * Unsupported JNI version 警告),之后随机原生崩溃。
     */
    javaPath: '',
    jvmArgs: '-Xmx4G',
    /** 摄像机账号名(必须与 bot 的名字不同) */
    username: 'AgentCamera',
    auth: 'offline' as 'offline' | 'microsoft',
    profilesFolder: '',
    width: 1280,
    height: 720,
    /** 启动即直连服务器(1.20+ 走 quickPlay,更早走 --server/--port) */
    autoJoin: true,
    /** 自动把摄像机切观察者模式并附身到 bot */
    autoSpectate: true,
    /** 周期性重下 spectate 指令(bot 死亡/重连会掉);0=只在事件点下 */
    resyncSec: 30,
    /** 摄像机进程崩了自动重启的上限(10 分钟窗口内);0=不重启 */
    restartMax: 3,
    /**
     * 启动前调整该游戏目录的设置:options.txt(失焦不暂停、跳引导屏、主音量拉满)
     * 与 SpectatorPlus 的 client.json(openScreens 按 syncGui 写)
     */
    noPauseOnLostFocus: true,
    /** GUI 演出:bot 开箱子/合成/熔炉时把那张界面同步到摄像机画面上(重启客户端生效) */
    syncGui: true,
  },
  /** 演出节拍:同步 GUI 开着时把容器操作放慢到人手速度;预算封顶防慢动作长镜头 */
  show: {
    clickMs: 400,
    dwellOpenMs: 800,
    dwellResultMs: 1200,
    dwellCloseMs: 600,
    reopenGapMs: 900,
    budgetMs: 12000,
  },
  /**
   * 玩家客户端:以普通玩家身份再开一份客户端进同一个服务器,人跟她一起玩。
   * 与观察者摄像机是两份进程、两个账号名,谁都不影响谁。
   */
  player: {
    /** 开着则 World 启动时一并拉起;关着也能在挂载面板里手动启停 */
    enabled: false,
    /** 玩家账号名(离线),必须与 bot 和摄像机都不同 */
    username: 'Player',
    auth: 'offline' as 'offline' | 'microsoft',
    profilesFolder: '',
    /** .minecraft 目录;空 = 用观察者客户端那一份 */
    gameDir: '',
    /** versions/ 下的版本 id;空 = 目录里唯一那个 */
    versionId: '',
    /** java 路径;空 = 用观察者客户端那一份 */
    javaPath: '',
    jvmArgs: '-Xmx4G',
    width: 1280,
    height: 720,
    /** 启动即直连服务器;关掉就停在主菜单自己进 */
    autoJoin: true,
    /** 进服后把这个玩家传送到 bot 旁边(服务器控制台优先,退回 bot 的 op 指令) */
    teleportToBot: true,
  },
} as const;

export interface MinecraftConfigSection {
  /** Observed journey opportunities wake the host; never force a stop or start inference in the core. */
  journey?: {enabled:boolean;choiceMinBlocks?:number;choiceMaxBlocks?:number;dangerChoiceMaxBlocks?:number};
  provider?: 'mineflayer' | 'java-client';
  javaClient?: import('../src/contracts/java-client.ts').JavaClientConfiguration;
  /** Generic fast-tactic execution permissions; no model endpoint or credentials. */
  combatOptions?: Partial<import('./combat-decision-types.ts').CombatExecutionPolicy>;
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  auth?: 'offline' | 'microsoft';
  profilesFolder?: string;
  loginConfigFile: string;
  /** Keepalive packet timeout in milliseconds, default 60 seconds. */
  keepAliveTimeoutMs?: number;
  /** Requested server chunk radius, 2..32; omitted preserves Mineflayer's default. Not a visibility/security boundary. */
  viewDistance?: number;
  /** Exact player-facing reply deduplication; 0 disables it, new inbound messages release it. */
  chatDuplicateWindowMs?: number;
  /** Connection-owned death display delay, 0..15000 milliseconds. */
  deathRespawnDelayMs?: number;
  version: string;
  viewerPort: number;
  viewerMaxSessions?: number;
  viewerAssetsDir: string;
  viewerSpeakerName: string;
  /** Human-opened metrics dashboard; no polling or discovery is performed by the core. */
  metricsDashboardUrl?: string;
  performanceBridge?: import('./relay-port.ts').RelayConfiguration;
  remoteTextures?: boolean;
  memory?: Partial<import('./game-memory-service.ts').GameMemoryConfig>;
  /** Explicit external reference indexes; separate from the personal game notebook. */
  knowledge?: import('./reference-index.ts').MinecraftKnowledgeConfig;
  /** Optional stable notebook owner, independent of the display name. Omit for legacy namespaces. */
  memoryAgentId?: string;
  /** Mineral queries only. Default uses actual sight; never grants movement or server permissions. */
  perception?: import('./perception-sight.ts').ObservationPolicy;
  /** Local viewer override; does not change the server's authenticated skin. */
  skinModel?: 'classic' | 'slim';
  localSkinEnabled?: boolean;
  visual: { background: boolean };
  photography?: Partial<import('../src/contracts/photography.ts').PhotographyConfig>;
  escapeCommand: string;
  local: {
    startWithWorld: boolean;
    serverDir: string;
    javaPath: string;
    jvmArgs: string;
    cheats: boolean;
  };
  world: { tickSec: number; moveThreshold: number; snapshotSec: number; snapshotAnchorSec: number };
  /** 寻路垫脚方块名单,顺序即优先级;列表外的不当垫脚用 */
  scaffoldBlocks: readonly string[];
  /** 前置试算：受理时报告否定，出队时阻断 hard；默认开启。 */
  precheck: boolean;
  protectionPreflight?: boolean;
  /** 受理回执附相同任务的上次终态；默认开启。 */
  priorOutcome: boolean;
  /** Legacy key for optional repeated-success evidence; never blocks a task. */
  repeatSuccessFallback: {
    enabled: boolean; skillsCsv: string; maxSuccesses: number; windowMinutes: number;
  };
  idle: {
    enabled: boolean; selector: 'random';
    afterArrival?: boolean;
    minIdleMs: number; minIntervalMs: number; maxIntervalMs: number; allowMovement: boolean;
  };
  reflex: {
    fightBack: boolean; fleeHealth: number;
    reactCooldownSec: number; antiDrown: boolean; antiLava: boolean;
  };
  combat: {
    enabled: boolean; engageRadius: number; chaseMax: number; maxSec: number;
    space: number; busyRatio: number; cooldownSec: number;
  };
  client: {
    enabled: boolean; gameDir: string; versionId: string; javaPath: string; jvmArgs: string;
    username: string; auth?: 'offline' | 'microsoft'; profilesFolder?: string; width: number; height: number;
    autoJoin: boolean; autoSpectate: boolean; resyncSec: number; restartMax: number;
    noPauseOnLostFocus: boolean; syncGui: boolean;
  };
  /** GUI 演出节拍(当前原生观众/摄像机与 syncGui 同时就绪时生效) */
  show: {
    clickMs: number; dwellOpenMs: number; dwellResultMs: number;
    dwellCloseMs: number; budgetMs: number; reopenGapMs: number;
  };
  player: {
    enabled: boolean; username: string; auth?: 'offline' | 'microsoft'; profilesFolder?: string; gameDir: string; versionId: string; javaPath: string;
    jvmArgs: string; width: number; height: number; autoJoin: boolean; teleportToBot: boolean;
  };
}

/**
 * java 路径旋钮的选择器过滤。只有 Windows 的 java 带 `.exe`;在别的平台上按这个后缀过滤,
 * `/usr/bin/java` 会被对话框挡在外面(见 web/path-picker.ts 的 validatePickedPath)。
 */
const JAVA_PATH_PICKER = process.platform === 'win32'
  ? { kind: 'file' as const, extensions: ['.exe'] }
  : { kind: 'file' as const };

/** 连接与本地服务器:重启生效的那些 */
export const MINECRAFT_CONFIG_GROUP: ConfigGroup = {
  id: 'world:minecraft',
  owner: 'world:minecraft',
  schema: {
    type: 'object',
    title: 'Minecraft · 连接',
    description: '连接项要重启 World 才生效；服务器路径在下次启动服务器时采用。',
    properties: {
      ...GAME_MEMORY_CONFIG_SCHEMA,
      'worlds.minecraft.knowledge.minedojo.indexFile': { type: 'string', title: 'MineDojo 本地参考索引', 'x-hot': false,
        description: '显式准备的绝对 SQLite 路径。空值不接入，不自动下载或写入个人记忆；准备说明见 docs/minedojo-knowledge.md。' },
      'worlds.minecraft.knowledge.minedojo.retrieval': { type: 'string', title: '外部知识检索', enum: ['hybrid','lexical','local-vector','semantic'], 'x-hot': false,
        description: '默认全文 + CPU 词元向量，词元相似度不是神经语义模型；semantic 需要明确配置且与索引一致的 embeddings 模型，失败报告本地回退。' },
      'worlds.minecraft.provider': { type: 'string', title: '客户端类型', enum: ['mineflayer', 'java-client'], 'x-hot': false,
        description: 'java-client 接管已进服的真实客户端；不会自动启动游戏或重连。' },
      'worlds.minecraft.javaClient.expectedUuid': { type: 'string', title: '真实玩家 UUID', 'x-hot': false,
        description: '必须与服务端实际身份一致；离线账号改名也可能改变 UUID，需要显式迁移。' },
      'worlds.minecraft.javaClient.expectedServer': { type: 'string', title: '真实客户端连接地址', 'x-hot': false },
      'worlds.minecraft.javaClient.controllerId': { type: 'string', title: '控制器标识', 'x-hot': false },
      'worlds.minecraft.javaClient.credentialsFile': { type: 'string', title: '真实客户端私有连接文件', 'x-hot': false,
        description: '选择该游戏实例生成的 agent-mc-bridge/connection.json，不复制旧令牌。', 'x-path': { kind: 'file', extensions: ['.json'] } },
      'worlds.minecraft.javaClient.ledgerDir': { type: 'string', title: '固定账本目录', 'x-hot': false,
        description: '固定目录保留改名和升级历史，不随显示名自动更换。', 'x-path': { kind: 'directory' } },
      'worlds.minecraft.javaClient.actionWaitMs': { type: 'integer', title: '短动作回执合并等待（毫秒）', minimum: 0, maximum: 2000, 'x-hot': false, description: '短动作在同一工具调用内等待真实终态，减少下一轮模型查询；超时仍返回受理状态，原动作不重投。0 只返回受理。' },
      'worlds.minecraft.javaClient.viewerMode': { type: 'string', enum: ['auto', 'data', 'framebuffer'], title: '网页画面来源', 'x-hot': false, description: 'auto 按当前客户端能力选择，网页打开才采样；data 使用真实游戏数据，framebuffer 使用配置的原生截图页。显式指定的模式不自动回退。' },
      'worlds.minecraft.javaClient.leaseMs': { type: 'integer', title: '控制权租期', minimum: 1000, maximum: 30000, 'x-hot': false,
        description: '宿主须显式续租，过期释放游戏按键；单位毫秒。' },
      'worlds.minecraft.host': { type: 'string', title: '服务器地址', 'x-hot': false },
      'worlds.minecraft.port': { type: 'integer', title: '端口', minimum: 1, maximum: 65535, 'x-hot': false },
      'worlds.minecraft.username': { type: 'string', title: '账号标识 / 离线游戏名', 'x-hot': false,
        description: '正版模式是本地缓存的账号标识，实际游戏名由微软验证的 Java profile 决定。' },
      'worlds.minecraft.auth': { type: 'string', title: '账号验证', enum: ['offline', 'microsoft'], 'x-hot': false },
      'worlds.minecraft.profilesFolder': { type: 'string', title: '正版凭据缓存目录', 'x-hot': false,
        description: '留空使用本部署的私有 auth/agent 目录；不要放进共享目录或提交到仓库。', 'x-path': { kind: 'directory' } },
      'worlds.minecraft.loginConfigFile': { type: 'string', title: '自动登录配置文件', 'x-hot': true,
        description: '按服务器和账号匹配系统提示，每连接提交一次；私有配置引用 DPAPI、环境变量或私有密码文件。等成功标记且角色进世界后才可操作。留空关闭，下次重连读取。',
        'x-path': { kind: 'file', extensions: ['.json'] } },
      'worlds.minecraft.version': {
        type: 'string', title: '协议版本', 'x-hot': false,
        description: 'auto 自动识别 Java 协议；也可填写 Mineflayer 支持的明确版本。渲染资产和 Java 客户端版本分别配置。',
      },
      'worlds.minecraft.viewerPort': {
        type: 'integer', title: 'viewer 端口', minimum: 0, maximum: 65535, 'x-hot': false,
        description: '0=不开。OBS 浏览器源与"viewer"帧源都使用这个端口。',
      },
      'worlds.minecraft.viewerMaxSessions': {
        type: 'integer', title: '观战连接上限', minimum: 0, 'x-hot': false,
        description: '默认 0=不限制普通观战连接；也可填写正整数。后台只读录制连接同样计数；截图有独立名额，不占普通观战名额。',
      },
      'worlds.minecraft.viewerAssetsDir': {
        type: 'string', title: '现代画面资源目录', 'x-hot': false,
        description: '空=自带网页画面；填写由对应游戏版本导出的现代画面资源包根目录。',
        'x-path': { kind: 'directory' },
      },
      'worlds.minecraft.viewerSpeakerName': {
        type: 'string', title: '网页语音气泡称呼', 'x-hot': false,
        description: '空=游戏内用户名；在现代画面中随实际语音播放显示。',
      },
      'worlds.minecraft.metricsDashboardUrl': {
        type: 'string', title: '模型消耗页面地址', 'x-hot': true,
        description: '可选。填写本 Agent 的指标页面地址；只有打开链接时浏览器访问，不扫描模型服务。独立连接台自带 /metrics 页面。',
      },
      'worlds.minecraft.visual.background': {
        type: 'boolean', title: '后台观察画面', 'x-hot': true,
        description: '未指定 background 的看图调用立即受理，结果通过事件返回；显式 background:false 仍等待结果。',
      },
      'worlds.minecraft.protectionPreflight': {
        type: 'boolean', title: '操作前查询方块保护', 'x-hot': true,
        description: '默认关闭：正常挖掘、放置和寻路不发保护查询；操作未获服务端确认后按目标诊断。已明确拒绝的目标仍跳过。',
      },
      'worlds.minecraft.photography.voxel.rendererSource': { type: 'string', title: '可选体素摄影：共享渲染器源码目录', 'x-hot': true },
      'worlds.minecraft.photography.voxel.assetPack': { type: 'string', title: '可选体素摄影：匹配原版素材目录', 'x-hot': true },
      'worlds.minecraft.photography.voxel.threeModule': { type: 'string', title: '可选体素摄影：Three.js 模块路径', 'x-hot': true },
      'worlds.minecraft.photography.voxel.radius': { type: 'integer', minimum: 0, maximum: 64, title: '体素摄影水平半径', 'x-hot': true },
      'worlds.minecraft.photography.voxel.below': { type: 'integer', minimum: 0, maximum: 64, title: '体素摄影下方范围', 'x-hot': true },
      'worlds.minecraft.photography.voxel.above': { type: 'integer', minimum: 0, maximum: 64, title: '体素摄影上方范围', 'x-hot': true },
      'worlds.minecraft.escapeCommand': {
        type: 'string', title: '普通玩家脱困指令', 'x-hot': false,
        description: '远程服务器可填普通玩家有权限使用的传送命令，例如 /spawn。空值使用受管服务器控制台。',
      },
      'worlds.minecraft.local.serverDir': {
        type: 'string', title: '本地服务器目录', 'x-hot': false,
        description: '含 server.jar 的目录;运行中修改会在停止并重新启动后采用。',
        'x-path': { kind: 'directory', recommendedDir: '../Cortico-Resources/minecraft/server' },
      },
      'worlds.minecraft.local.startWithWorld': {
        type: 'boolean', title: '随 World 启动服务器', 'x-hot': false,
        description: '开=World 启动时拉起本地服务器并连接。未配置服务器目录时不起作用。',
      },
      'worlds.minecraft.local.javaPath': {
        type: 'string', title: '服务器 java 路径', 'x-hot': true,
        description: '空 = 自动:服务器目录邻近的 jdk/,再退回 PATH 上的 java。',
        'x-path': JAVA_PATH_PICKER,
      },
      'worlds.minecraft.local.jvmArgs': {
        type: 'string', title: '服务器 JVM 参数', 'x-hot': true,
        description: '空格分隔,下次启动生效。默认 -Xms1G -Xmx2G。',
      },
      'worlds.minecraft.local.cheats': {
        type: 'boolean', title: '自动授权作弊权限', 'x-hot': true,
        description: '本 World 每次启动服务器前,把她、摄像机、玩家补进管理员名单(ops.json,4 级)。'
          + '关掉则只按名单现状来。名单与相关的服务器项在「权限与作弊」面板里改。',
      },
    },
  },
};

export const MINECRAFT_RHYTHM_CONFIG_GROUP: ConfigGroup = {
  id: 'world:minecraft:rhythm',
  owner: 'world:minecraft',
  schema: {
    type: 'object',
    title: 'Minecraft · 节奏与反射',
    description:
      '节流决定多久才值得说一次话;反射是不经 LLM 的自保,做了什么一律事后汇报。都热改即生效。',
    properties: {
      'worlds.minecraft.world.tickSec': {
        type: 'integer', title: '世界节流 tick', minimum: 5, maximum: 300, 'x-suffix': 's', 'x-hot': true,
      },
      'worlds.minecraft.deathRespawnDelayMs': {
        type: 'integer', title: '死亡后重生等待', minimum: 0, maximum: 15000, 'x-suffix': 'ms', 'x-hot': false,
        description: '连接内实际重生前的等待时间；服务端主动重生优先。停止 World 或断开连接会取消尚未派发的重生；mc_stop 仅清理任务。',
      },
      'worlds.minecraft.viewDistance': {
        type: 'integer', title: '请求区块视距', minimum: 2, maximum: 32, 'x-suffix': 'chunks', 'x-hot': false,
        description: 'Mineflayer 请求服务端发送的区块半径；省略沿用上游默认。服务端可能限制或忽略；不代替视线过滤或防透视。',
      },
      'worlds.minecraft.perception.mineralVision': { type:'boolean',title:'矿物透视查询','x-hot':false,
        description:'默认关闭，只返回真实视线内的方块。开启仅扩展方块查询至 32 格内已接收的矿物，不代表亲眼看见，也不放宽身体动作权限。' },
      'worlds.minecraft.memoryAgentId': { type:'string',title:'游戏笔记稳定角色标识','x-hot':false,
        description:'可选。与显示名称分离，用于同一服务器与账号的持久笔记；修改会切换命名空间，不迁移或合并旧笔记。' },
      'worlds.minecraft.skinModel': { type:'string',enum:['classic','slim'],title:'本地预览皮肤手臂','x-hot':false },
      'worlds.minecraft.localSkinEnabled': { type:'boolean',title:'使用本地预览皮肤','x-hot':false,
        description:'只影响同连接网页画面的本人皮肤；不修改正版账号材质或假定服务端支持换肤命令。' },
      'worlds.minecraft.world.moveThreshold': {
        type: 'integer', title: '位移播报阈值', minimum: 4, maximum: 200, 'x-suffix': '格', 'x-hot': true,
      },
      'worlds.minecraft.world.snapshotSec': {
        type: 'integer', title: '世界快照间隔', minimum: 5, maximum: 300, 'x-suffix': 's', 'x-hot': true,
        description: '世界快照随下一批事件投递，不单独唤醒；投递时读取世界状态。此值为快照的最短间隔。',
      },
      'worlds.minecraft.world.snapshotAnchorSec': {
        type: 'integer', title: '快照全量锚间隔', minimum: 60, maximum: 3600, 'x-suffix': 's', 'x-hot': true,
        description: '快照按段去重,只发有变化的段;距上一份全量超过此间隔就强制发一次全量,给增量流的基线兜底(上下文截断后也会强制全量)。',
      },
      'worlds.minecraft.precheck': {
        type: 'boolean', title: '前置试算', 'x-hot': true,
        description: '受理任务时先纯读试算一遍,把「现在就做不成」的步当场写进受理回执(只报否定);每一步动手前再试算一次,判死的步不动手。关掉则回到旧行为:照跑、跑完才知道。',
      },
      'worlds.minecraft.priorOutcome': {
        type: 'boolean', title: '受理回执带上次下场', 'x-hot': true,
        description: '维度、受理站位和完整参数相同时，受理回执引用15分钟内的历史任务号、原目标与未达成结果；换坐标、方法或数量不借用旧原因。同类提交次数单独统计，不能据此判定有无进展。关闭时不引用历史原因。',
      },
      'worlds.minecraft.repeatSuccessFallback.enabled': {
        type: 'boolean', title: '同类成功任务提示', 'x-hot': true,
        description: '窗口内同类技能成功达到次数后附历史提示；不拒收任务或跳过步骤。默认关闭。保留旧配置键，不改变已存配置。',
      },
      'worlds.minecraft.repeatSuccessFallback.skillsCsv': {
        type: 'string',
        title: '提示目标技能', 'x-hot': true,
        description: '英文技能名用逗号分隔，例如 fish,collect。留空时不附此类历史提示。',
      },
      'worlds.minecraft.repeatSuccessFallback.maxSuccesses': {
        type: 'integer', title: '成功提示阈值', minimum: 2, maximum: 20, 'x-hot': true,
        description: '达到此次数后附历史提示；不是成功次数额度。',
      },
      'worlds.minecraft.repeatSuccessFallback.windowMinutes': {
        type: 'integer', title: '成功计数窗口', minimum: 1, maximum: 60,
        'x-suffix': '分钟', 'x-hot': true,
      },
      'worlds.minecraft.idle.enabled': {
        type: 'boolean', title: '空闲小动作', 'x-hot': true,
        description: '空闲时穿插转头、姿态与只读背包预览；任务、战斗和交互开始时取消。默认关闭。',
      },
      'worlds.minecraft.idle.selector': {
        type: 'string', enum: ['random'], title: '小动作选择', 'x-hot': true,
        description: '按已授权候选随机轮换。模型选择由宿主单独配置。',
      },
      'worlds.minecraft.idle.afterArrival': {
        type: 'boolean', title: '到达后观察四周', 'x-hot': true,
        description: '导航完成且队列空闲后立即随机选择一次转头观察，之后沿用小动作间隔。',
      },
      'worlds.minecraft.idle.minIdleMs': {
        type: 'integer', title: '开始小动作前空闲时间', minimum: 1000, maximum: 60000, 'x-suffix': 'ms', 'x-hot': true,
      },
      'worlds.minecraft.idle.minIntervalMs': {
        type: 'integer', title: '小动作最短间隔', minimum: 5000, maximum: 120000, 'x-suffix': 'ms', 'x-hot': true,
      },
      'worlds.minecraft.idle.maxIntervalMs': {
        type: 'integer', title: '小动作最长间隔', minimum: 5000, maximum: 300000, 'x-suffix': 'ms', 'x-hot': true,
      },
      'worlds.minecraft.idle.allowMovement': {
        type: 'boolean', title: '允许空闲短步', 'x-hot': true,
        description: '只走已加载、连续实心平地上的短步，不挖掘、搭路或进入水中。',
      },
      'worlds.minecraft.chatDuplicateWindowMs': { type: 'integer', title: '相同回复去重窗口', minimum: 0, 'x-suffix': 'ms', 'x-hot': true,
        description: '只去重同频道/同私聊接收人的相同文字；收到对方新消息即允许回复。0 关闭。不限制新内容，不拦业务命令。' },
      'worlds.minecraft.reflex.fightBack': {
        type: 'boolean', title: '受击反击', 'x-hot': true,
        description: '关掉则挨打不还手,打不打交给主脑决定;血线以下的脱离不受它影响。',
      },
      'worlds.minecraft.reflex.fleeHealth': {
        type: 'integer', title: '脱离战斗血线', minimum: 0, maximum: 20, 'x-hot': true,
        description: '生命低于此值就撤,不恋战。反击关着也照样撤。只管会还手的(玩家和敌对生物):打猪打鱼这类找吃的不受血线约束。',
      },
      'worlds.minecraft.reflex.reactCooldownSec': {
        type: 'integer', title: '受击反应冷却', minimum: 1, maximum: 120, 'x-suffix': 's', 'x-hot': true,
      },
      'worlds.minecraft.reflex.antiDrown': { type: 'boolean', title: '自动踩水与防溺水上浮', 'x-hot': true,
        description: '关闭后不再自动按跳跃、找岸或冻结水中任务，并释放已发生的上浮接管。手动游泳、潜水程序与正常寻路继续可用；氧气和伤害观测仍保留。' },
      'worlds.minecraft.reflex.antiLava': {
        type: 'boolean', title: '挨烧自动逃离', 'x-hot': true,
        description: '碰到岩浆/火就立刻手动冲出去,再交给寻路器。判定看碰撞箱压着什么,'
          + '不是脚下那格——贴着岩浆边缘走时人已经在掉血而中心格还是空气。关掉则烧死为止。',
      },
      'worlds.minecraft.combat.enabled': {
        type: 'boolean', title: '战斗模式(夜间自保)', 'x-hot': true,
        description: '被打或敌对贴到触发半径内就接管移动与出手打完这一场,期间任务挂起、'
          + '事件照常推(夺手不夺嘴)。不主动招惹。关掉退回"受击反击"那套 10 秒挥两下。',
      },
      'worlds.minecraft.journey.enabled': {
        type:'boolean',title:'旅途新发现提醒','x-hot':true,
        description:'长途经过新的可见村民、告示牌或地标时，提供保留原目的地的短探索选择；是否停留由Agent判断，不自动改路或打断任务。',
      },
      'worlds.minecraft.journey.choiceMinBlocks': {
        type:'number',title:'路线建议常规位移容差起点',minimum:1,maximum:64,'x-suffix':'格','x-hot':true,
        description:'默认10格。建议有效距离=min(上限,起点+实测速度×决策耗时)，只允许同一任务的短期位移；不改变寻路与安全让位判定。',
      },
      'worlds.minecraft.journey.choiceMaxBlocks': {
        type:'number',title:'路线建议常规位移容差上限',minimum:1,maximum:64,'x-suffix':'格','x-hot':true,
        description:'默认20格，不能小于起点。目标、身体控制权、受伤、战斗和服务端传送变化仍立即使旧建议失效。',
      },
      'worlds.minecraft.journey.dangerChoiceMaxBlocks': {
        type:'number',title:'有风险时路线建议位移上限',minimum:1,maximum:64,'x-suffix':'格','x-hot':true,
        description:'默认5格。已见敌对种类、低生命或伤害效果时缩小建议容差；附近玩家不自动算敌人。这不是自动接敌或通行安全证明。',
      },
      'worlds.minecraft.combat.engageRadius': {
        type: 'integer', title: '战斗触发半径', minimum: 2, maximum: 8, 'x-suffix': '格', 'x-hot': true,
        description: '敌对贴到这么近才动手;不是先手圈,是"找上门"的判据。',
      },
      'worlds.minecraft.combat.chaseMax': {
        type: 'integer', title: '战斗追击上限', minimum: 4, maximum: 24, 'x-suffix': '格', 'x-hot': true,
      },
      'worlds.minecraft.combat.maxSec': {
        type: 'integer', title: '战斗硬时长', minimum: 10, maximum: 300, 'x-suffix': 's', 'x-hot': true,
        description: '到点强制收手交还,哪怕怪还在——刷怪笼旁边"索得到敌"永久为真,没有这道闸就是直播失声。',
      },
      'worlds.minecraft.combat.space': {
        type: 'number', title: '战斗理想间距', minimum: 2.0, maximum: 2.95, 'x-suffix': '格', 'x-hot': true,
        description: '僵尸有效攻击距离约 2.2-2.4 格、出手上限 3.0。2.88 几乎不挨打(更强),'
          + '2.6 偶尔挨打(更像人)。这是观感旋钮。',
      },
      'worlds.minecraft.combat.busyRatio': {
        type: 'integer', title: '战斗占比闸', minimum: 10, maximum: 100, 'x-suffix': '%', 'x-hot': true,
        description: '5 分钟滑窗里战斗时长占比超过此值就强制冷却,不再自动进场——怪一波接一波的地方该换地方,不该无限打。',
      },
      'worlds.minecraft.combat.cooldownSec': {
        type: 'integer', title: '战斗冷却', minimum: 10, maximum: 600, 'x-suffix': 's', 'x-hot': true,
        description: '占比闸触发后这么久内不自动进场(挨打了照样还手)。',
      },
      'worlds.minecraft.show.clickMs': {
        type: 'integer', title: '演出·逐格间隔', minimum: 0, maximum: 2000, 'x-suffix': 'ms', 'x-hot': true,
        description: 'GUI 演出开着时,逐格摆料/逐栈存取之间停这么久。0=瞬时。'
          + '没有当前原生观众/摄像机或「GUI 演出」关着时,整套节拍自动归零。',
      },
      'worlds.minecraft.show.dwellOpenMs': {
        type: 'integer', title: '演出·开窗停顿', minimum: 0, maximum: 3000, 'x-suffix': 'ms', 'x-hot': true,
        description: '打开容器界面后，等待此时长再操作。',
      },
      'worlds.minecraft.show.dwellResultMs': {
        type: 'integer', title: '演出·产物亮相', minimum: 0, maximum: 5000, 'x-suffix': 'ms', 'x-hot': true,
        description: '合成材料摆齐后停一拍,让产出槽在画面上亮一会儿再收。',
      },
      'worlds.minecraft.show.dwellCloseMs': {
        type: 'integer', title: '演出·关窗停顿', minimum: 0, maximum: 3000, 'x-suffix': 'ms', 'x-hot': true,
      },
      'worlds.minecraft.show.reopenGapMs': {
        type: 'integer', title: '演出·再开窗间隔', minimum: 0, maximum: 3000, 'x-suffix': 'ms', 'x-hot': true,
        description: '关闭容器界面到下次打开的最短间隔，不计入单次预算。',
      },
      'worlds.minecraft.show.budgetMs': {
        type: 'integer', title: '演出·单次预算', minimum: 0, maximum: 30000, 'x-suffix': 'ms', 'x-hot': true,
        description: '一单操作的节拍总预算；多轮合成按全部步骤均摊，预算不足会记录节拍缩短；未知长度的存取耗尽后减少等待。',
      },
    },
  },
};

/** 画面与观察者客户端 */
export const MINECRAFT_CLIENT_CONFIG_GROUP: ConfigGroup = {
  id: 'world:minecraft:client',
  owner: 'world:minecraft',
  schema: {
    type: 'object',
    title: 'Minecraft · 观察者客户端',
    description:
      '真游戏窗口以观察者模式跟着 bot,与观众同一幅画面(含光影/模组),代价是一份客户端进程。' +
      '观众看到的画面由 OBS 采集这扇窗口或 viewer 网页,不经 World。',
    properties: {
      'worlds.minecraft.client.enabled': {
        type: 'boolean', title: '观察者客户端', 'x-hot': false,
        description: '开启后 World 启动时一并拉起客户端;也可以在挂载面板里单独启停。',
      },
      'worlds.minecraft.client.gameDir': {
        type: 'string', title: '.minecraft 目录', 'x-hot': false,
        description: '未配置时观察者客户端起不来。运行中修改会在停止并重新启动后采用。',
        'x-path': { kind: 'directory', recommendedDir: '../Cortico-Resources/minecraft/client' },
      },
      'worlds.minecraft.client.versionId': {
        type: 'string', title: '版本 id', 'x-hot': true,
        description: '空 = versions/ 下唯一那个。Fabric+Iris 这类填整合版目录名,继承关系自动解。',
      },
      'worlds.minecraft.client.javaPath': {
        type: 'string', title: '客户端 java 路径', 'x-hot': true,
        description:
          '空 = PATH 上的 java。版本要与游戏对上:1.20.6 用 Java 21。更高的 JDK 会让游戏自带的 '
          + 'LWJGL 3.3.3 认不出 JNI 版本(启动日志里有 Unsupported JNI version 警告),之后随机原生崩溃。',
        'x-path': JAVA_PATH_PICKER,
      },
      'worlds.minecraft.client.jvmArgs': {
        type: 'string', title: '客户端 JVM 参数', 'x-hot': true,
        description: '空格分隔。开光影建议 -Xmx4G 起。',
      },
      'worlds.minecraft.client.auth': { type: 'string', title: '客户端账号验证', enum: ['offline', 'microsoft'], 'x-hot': false },
      'worlds.minecraft.client.profilesFolder': { type: 'string', title: '客户端正版缓存目录', 'x-hot': false,
        description: '留空使用本部署对应账号的私有缓存；与 Agent 账号分开。', 'x-path': { kind: 'directory' } },
      'worlds.minecraft.client.username': {
        type: 'string', title: '摄像机账号名', 'x-hot': true,
        description: '离线账号,必须与 bot 的游戏内用户名不同。',
      },
      'worlds.minecraft.client.width': {
        type: 'integer', title: '窗口宽', minimum: 320, maximum: 3840, 'x-suffix': 'px', 'x-hot': true,
      },
      'worlds.minecraft.client.height': {
        type: 'integer', title: '窗口高', minimum: 240, maximum: 2160, 'x-suffix': 'px', 'x-hot': true,
      },
      'worlds.minecraft.client.autoJoin': {
        type: 'boolean', title: '启动即进服', 'x-hot': true,
      },
      'worlds.minecraft.client.autoSpectate': {
        type: 'boolean', title: '自动观察者附身', 'x-hot': true,
        description: '进服后把摄像机切 spectator 并附身到 bot。经服务器控制台下指令;外部服务器则借 bot 的 op 权限。',
      },
      'worlds.minecraft.client.resyncSec': {
        type: 'integer', title: '附身重下间隔', minimum: 0, maximum: 600, 'x-suffix': 's', 'x-hot': true,
        description: 'bot 死亡/重连会掉附身,周期性重下;0=只在进服与重生这些事件点下。',
      },
      'worlds.minecraft.client.restartMax': {
        type: 'integer', title: '崩溃自动重启上限', minimum: 0, maximum: 10, 'x-suffix': '次', 'x-hot': true,
        description: '异常退出后自动重启，等待时间从 30 秒起逐次加倍；超过重启上限后停止重试并报警。'
          + '相邻两次异常退出间隔超过 10 分钟时重置计数。0 表示禁用自动重启。',
      },
      'worlds.minecraft.client.noPauseOnLostFocus': {
        type: 'boolean', title: '调整启动选项', 'x-hot': true,
        description: '启动前改该游戏目录的设置。options.txt:关 pauseOnLostFocus(alt+tab 切走不弹暂停菜单)、'
          + '跳过首启引导屏、主音量拉满(为 0 时游戏整个没声)。'
          + 'SpectatorPlus:同步屏幕按「GUI 演出」开关写。'
          + '指向你自己常玩的 .minecraft 时记得关掉这个开关。',
      },
      'worlds.minecraft.client.syncGui': {
        type: 'boolean', title: 'GUI 演出', 'x-hot': false,
        description: 'bot 开箱子/合成/熔炉时,把那张界面同步到摄像机画面上'
          + '(SpectatorPlus 的 Open Synced Screens),配合「节奏与反射」里的演出节拍,'
            + '原生 Web 观众就绪时也启用节拍，包括背包里的 2x2 合成；Java 摄像机不展示 2x2。'
            + '客户端重启生效。',
      },
    },
  },
};

/** 人自己进服那一份客户端。 */
export const MINECRAFT_PLAYER_CONFIG_GROUP: ConfigGroup = {
  id: 'world:minecraft:player',
  owner: 'world:minecraft',
  schema: {
    type: 'object',
    title: 'Minecraft · 玩家客户端',
    description:
      '以普通玩家身份再开一份客户端进同一个服务器,跟她一起玩。与观察者摄像机是两份进程、'
      + '两个账号名。默认用摄像机那份 .minecraft;要装不同的 World 就另指一个目录。'
      + '进服的时刻由 bot 的玩家列表看到,那一刻把人传送到她旁边。',
    properties: {
      'worlds.minecraft.player.enabled': {
        type: 'boolean', title: '玩家客户端', 'x-hot': false,
        description: '开启后 World 启动时一并拉起;也可以在挂载面板里单独启停。',
      },
      'worlds.minecraft.player.auth': { type: 'string', title: '客户端账号验证', enum: ['offline', 'microsoft'], 'x-hot': false },
      'worlds.minecraft.player.profilesFolder': { type: 'string', title: '客户端正版缓存目录', 'x-hot': false,
        description: '留空使用本部署对应账号的私有缓存；与 Agent 账号分开。', 'x-path': { kind: 'directory' } },
      'worlds.minecraft.player.username': {
        type: 'string', title: '玩家名', 'x-hot': true,
        description: '离线账号,必须与 bot 和摄像机的名字都不同。传送认的就是这个名字。',
      },
      'worlds.minecraft.player.gameDir': {
        type: 'string', title: '.minecraft 目录', 'x-hot': false,
        description: '空 = 用观察者客户端那一份。两份客户端共用一个目录时设置文件是共享的:'
          + '谁最后启动谁说了算,要各自成套只能各给一个目录。natives 仍按账号分开,不会抢同一组 DLL。'
          + '共用时启动前会把聊天可见性掰回 FULL——摄像机为画面干净关掉的聊天连命令行一起关,'
          + '人进了服 T 和 / 都按不动。',
        'x-path': { kind: 'directory', recommendedDir: '../Cortico-Resources/minecraft/client-player' },
      },
      'worlds.minecraft.player.versionId': {
        type: 'string', title: '版本 id', 'x-hot': true,
        description: '空 = versions/ 下唯一那个。要与服务器同版本。',
      },
      'worlds.minecraft.player.javaPath': {
        type: 'string', title: 'java 路径', 'x-hot': true,
        description: '空 = 用观察者客户端那一份。',
        'x-path': JAVA_PATH_PICKER,
      },
      'worlds.minecraft.player.jvmArgs': { type: 'string', title: 'JVM 参数', 'x-hot': true },
      'worlds.minecraft.player.width': {
        type: 'integer', title: '窗口宽', minimum: 320, maximum: 3840, 'x-suffix': 'px', 'x-hot': true,
      },
      'worlds.minecraft.player.height': {
        type: 'integer', title: '窗口高', minimum: 240, maximum: 2160, 'x-suffix': 'px', 'x-hot': true,
      },
      'worlds.minecraft.player.autoJoin': {
        type: 'boolean', title: '启动即进服', 'x-hot': true,
        description: '关掉就停在主菜单,自己从多人游戏里进。',
      },
      'worlds.minecraft.player.teleportToBot': {
        type: 'boolean', title: '进服传送到她旁边', 'x-hot': true,
        description: '经服务器控制台下 tp;外部服务器则借 bot 的 op 权限。挂载面板里也能随时手动传一次。',
      },
    },
  },
};
