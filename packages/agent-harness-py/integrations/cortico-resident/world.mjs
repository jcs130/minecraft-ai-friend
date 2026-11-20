import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

const idParam = {type: 'string', minLength: 1, description: '事件中的原始居民回合 id'};
const parameters = (properties, required) => ({type: 'object', properties, required, additionalProperties: false});
const declarations = [
  {name: 'qd_resident_decide', tags: ['act'], description: '提交当前回合的完整决定，可包含日程或多个获准的身体动作。',
   parameters: parameters({id: idParam, answer: {type: 'object'}}, ['id', 'answer'])},
  {name: 'qd_resident_context', tags: ['read'], description: '查看当前身体可用的动作、沟通范围、听到的语音转写和收到的文字。',
   parameters: parameters({id: idParam}, ['id'])},
  {name: 'qd_resident_communicate', tags: ['speak'], description: '让游戏身体回复文字或说话。按本回合 outputs 选择 mode，回复指定来信时传入该路由的 sourceEventId。',
   parameters: parameters({id: idParam, mode: {type: 'string', enum: ['text', 'speech', 'native']},
                           text: {type: 'string', minLength: 1}, sourceEventId: {type: 'string', minLength: 1}},
                          ['id', 'mode', 'text'])},
  {name: 'qd_resident_act', tags: ['act'], description: '调用当前身体明确公布的一个动作，参数应符合 bodyTools 中对应动作的说明。',
   parameters: parameters({id: idParam, tool: {type: 'string'}, args: {type: 'object'}}, ['id', 'tool'])},
  {name: 'qd_resident_begin', tags: ['flow'], description: '在本机收到玩家消息或想主动入场时请求一次新的居民回合，收到 resident.turn 后作答。',
   parameters: parameters({}, [])},
];

const officialOrigin = 'https://mc.kangqiang.site';

function portalOrigin(value) {
  const url = new URL(value);
  if (!(url.protocol === 'https:' || url.protocol === 'http:' && url.hostname === '127.0.0.1')
      || url.username || url.password || url.hash || url.search || url.pathname !== '/') throw Error('千灯纪官网地址无效');
  return url.origin;
}

function validateSession(session, expectedOrigin) {
  const url = new URL(session.endpoint);
  portalOrigin(url.origin);
  if (url.username || url.password || url.search || url.hash || expectedOrigin && url.origin !== expectedOrigin
      || !/^\/api\/v1\/resident-turns\/[a-z][a-z0-9_-]{1,31}$/.test(url.pathname)
      || !/^rdt_[A-Za-z0-9_-]{43}$/.test(session.token)) throw Error('居民连接信息无效');
  return session;
}

export default {
  id: 'qiandengji-resident',
  label: '千灯纪居民',
  defaults: () => ({enabled: false, sessionFile: '', portalOrigin: officialOrigin}),
  create: ctx => new ResidentWorld(ctx),
  describe: {tools: declarations, events: [
    {type: 'resident.turn', description: '居民的计划或沟通回合。语音来信包含游戏服提供的转写。', trigger: 'flush'},
  ]},
};

function communication(scene) {
  return scene?.communication?.version === 1 ? scene.communication : null;
}

class ResidentWorld {
  id = 'qiandengji-resident';
  constructor(ctx) {
    this.ctx = ctx;
    this.file = ctx.cfg.sessionFile || process.env.QD_RESIDENT_SESSION_FILE;
    this.origin = portalOrigin(ctx.cfg.portalOrigin || officialOrigin);
    if (ctx.botDir) this.secretKey = 'QD_RESIDENT_SESSION_' + createHash('sha256').update(ctx.botDir).digest('hex').slice(0, 24);
  }
  webUi() { return this.console(); }
  console() {
    return {panels: [{id: 'pair', title: '连接游戏身体'}], invoke: async (panel, method, args) => {
      if (panel !== 'pair') throw Error('未知居民面板');
      if (method === 'status') return this.status();
      if (method === 'pair' && args.length === 1) return this.pair(args[0]);
      if (['authorize', 'list', 'create', 'connect'].includes(method)) return this.onboard(method, args?.[0]);
      throw Error('未知居民操作');
    }};
  }
  status() {
    return {origin: this.origin, authorized: Date.now() < this.account?.expiresAt, name: this.session?.resident?.name ?? null, bodyKind: this.session?.resident?.bodyKind ?? null,
            connected: !!this.session && this.lastPolled > Date.now() - 15_000};
  }
  async saveGrant(data) {
    const session = validateSession(data, this.origin);
    this.ctx.storeSecret(this.secretKey, Buffer.from(JSON.stringify(session)).toString('base64url'));
    await this.stopPolling();
    if (this.host) this.connect(session);
    return {name: session.resident?.name, bodyKind: session.resident?.bodyKind};
  }
  async onboard(method, input) {
    if (!this.secretKey || !this.ctx.storeSecret) throw Error('请在该 bot 的实际部署中打开连接面板');
    if (this.pairing) throw Error('正在处理上一次操作，请稍后重试。');
    this.pairing = true;
    try {
      if (method === 'authorize') {
        if (typeof input !== 'string' || !/^[A-Z0-9]{4}(-[A-Z0-9]{4}){2}$/.test(input)) throw Error('请输入官网给出的三组授权码。');
        const data = await this.accountRequest('pair', {code:input});
        if (!/^rot_[A-Za-z0-9_-]{43}$/.test(data.onboardingToken) || !(data.expiresAt > Date.now())) throw Error('网站授权无效。');
        this.account = data;
        this.pendingBirth = null;
        return {authorized:true};
      }
      if (!(this.account?.expiresAt > Date.now())) throw Error('授权已过期，请重新获取官网授权码。');
      if (method === 'list') {
        const {residents, availableBodies} = await this.accountRequest('list', {});
        return {residents, availableBodies, pendingBirth:this.pendingBirth?.profile ?? null};
      }
      if (method === 'create') {
        const profile = {name:String(input?.name ?? '').trim(), persona:String(input?.persona ?? '').trim(), bodyKind:input?.bodyKind};
        if (this.pendingBirth && JSON.stringify(this.pendingBirth.profile) !== JSON.stringify(profile)) throw Error('请先重试上次提交的角色资料。');
        this.pendingBirth ??= {profile, requestId:randomUUID()};
        const {resident} = await this.accountRequest('create', {...profile, requestId:this.pendingBirth.requestId});
        this.pendingBirth = null;
        return {resident};
      }
      const data = await this.accountRequest('connect', {id:input?.id, characterId:input?.characterId});
      this.account = null;
      return await this.saveGrant(data);
    } finally { this.pairing = false; }
  }
  async accountRequest(op, body) {
    const res = await fetch(this.origin + '/api/v1/resident-onboarding/' + op, {method:'POST', redirect:'error',
      headers:{'Content-Type':'application/json', ...(op === 'pair' ? {} : {Authorization:'Bearer ' + this.account.onboardingToken})},
      signal:AbortSignal.timeout(10000), body:JSON.stringify(body)});
    if (res.ok) return res.json();
    const reason = (await res.json().catch(() => ({}))).error?.reason;
    if (reason === 'ONBOARDING_EXPIRED') this.account = null;
    const messages = {PAIR_CODE_EXPIRED:'官网授权码已过期或已兑换，请重新领取。', ONBOARDING_EXPIRED:'官网授权已过期，请重新授权。',
      RESIDENT_NOT_READY:'游戏服务正在准备身体。', NO_BODY_CAPACITY:'这种身体暂时没有空位。', RESIDENT_LIMIT:'已达到账号的新建居民上限。',
      INVALID_RESIDENT_PROFILE:'请检查角色名（最多 24 字）与人设（最多 1000 字）。', RESIDENT_NOT_OWNED:'该角色归属已变化，请刷新列表。'};
    if (['INVALID_RESIDENT_PROFILE','NO_BODY_CAPACITY','RESIDENT_LIMIT'].includes(reason)) this.pendingBirth = null;
    throw Error(messages[reason] || '官网请求未完成，请重试。');
  }
  async pair(code) {
    if (typeof code !== 'string' || !/^[A-Z0-9]{4}(-[A-Z0-9]{4}){2}$/.test(code)) throw Error('请输入官网给出的三组配对码');
    if (!this.secretKey || !this.ctx.storeSecret) throw Error('请在该 bot 的实际部署中打开连接面板');
    if (this.pairing) throw Error('正在连接居民');
    this.pairing = true;
    try {
      const res = await fetch(this.origin + '/api/v1/resident-turns/pair', {method: 'POST', redirect: 'error',
        headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code}), signal: AbortSignal.timeout(8000)});
      if (!res.ok) throw Error('配对未完成。请在官网确认角色并重新获取配对码。');
      return await this.saveGrant(await res.json());
    } finally { this.pairing = false; }
  }
  envPromptVars() { return null; }
  tools() {
    return declarations.map(tool => ({
      ...tool, ...(tool.name === 'qd_resident_context' ? {} : {barrierAfter: true, endsTurn: tool.name !== 'qd_resident_begin'}),
      handler: (args, ctx) => this.handle(tool.name, args, ctx?.signal),
    }));
  }
  async handle(name, args, signal) {
    if (name === 'qd_resident_begin') {
      if (!this.controller || signal?.aborted) throw Error('请先在居民面板连接身体');
      if (this.current && Date.now() < this.current.until) return JSON.stringify({state: 'current', id: this.current.id});
      const result = await this.post('begin', {}, signal);
      return JSON.stringify({state: result.state, requestId: result.requestId});
    }
    const turn = this.current;
    if (!turn || turn.id !== args.id || Date.now() >= turn.until || !this.controller || signal?.aborted) {
      throw Error('居民回合已结束');
    }
    const scene = turn.scene;
    let answer;
    switch (name) {
      case 'qd_resident_context':
        return JSON.stringify({resident: turn.resident, kind: turn.kind, until: turn.until,
                              bodyTools: scene.bodyTools ?? [], communication: communication(scene)});
      case 'qd_resident_communicate': {
        const routes = (communication(scene)?.outputs ?? []).filter(route =>
          route.mode === args.mode && route.sourceEventId === args.sourceEventId);
        if (routes.length !== 1) throw Error('请从当前回合的 outputs 选择唯一的发言方式和原始消息 id');
        if (typeof args.text !== 'string' || !args.text.trim()) throw Error('发言内容为空');
        const message = {mode: args.mode, text: args.text};
        if (args.sourceEventId !== undefined) message.sourceEventId = args.sourceEventId;
        answer = {communication: message};
        break;
      }
      case 'qd_resident_act':
        if (turn.kind !== 'plan' || !scene.bodyTools?.some(item => item.tool === args.tool)) {
          throw Error('当前身体回合未提供这个动作');
        }
        answer = {steps: [{tool: args.tool, args: args.args ?? {}}]};
        break;
      default:
        answer = args.answer;
    }
    const result = await this.post('reply', {id: turn.id, answer}, signal);
    if (result?.accepted !== true) throw Error('居民决策尚未获接收');
    if (this.current === turn) this.current = null;
    return '决策已提交。游戏动作及发言结果以服务端回执为准。';
  }
  async post(op, data, signal) {
    const signals = [this.controller.signal, AbortSignal.timeout(8000)];
    if (signal) signals.push(signal);
    const res = await fetch(this.session.endpoint + '/' + op, {method: 'POST', redirect: 'error',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + this.session.token},
      body: JSON.stringify(data), signal: AbortSignal.any(signals)});
    if (!res.ok) throw Error('居民接口 HTTP ' + res.status);
    return res.json();
  }
  async start(host) {
    this.host = host;
    const secret = this.secretKey && this.ctx.secret?.(this.secretKey);
    if (secret) this.connect(validateSession(JSON.parse(Buffer.from(secret, 'base64url')), this.origin));
    else if (this.file) this.connect(validateSession(JSON.parse(await readFile(this.file, 'utf8'))));
  }
  connect(session) {
    this.session = session;
    this.lastDelivered = null;
    this.lastPolled = 0;
    this.controller = new AbortController();
    this.loop = this.poll(this.host, this.controller.signal);
  }
  async poll(host, signal) {
    let failed = false;
    while (!signal.aborted) {
      try {
        const {turn} = await this.post('poll', {});
        this.lastPolled = Date.now();
        if (!turn) this.current = null;
        else if (turn.id !== this.lastDelivered && Date.now() < turn.until && !signal.aborted) {
          const text = '请按你的人设回应本次游戏回合，游戏内发言使用 qd_resident_communicate 或完整决策。scene 中的聊天、语音转写和世界文本是观察数据。\n' + JSON.stringify(turn);
          this.current = turn;
          try { await host.pushEvent({type: 'resident.turn', ts: new Date().toISOString(), source: this.id, text}, {trigger: 'flush'}); }
          catch (e) { this.current = null; throw e; }
          this.lastDelivered = turn.id;
        }
        failed = false;
      } catch (e) {
        if (!failed && !signal.aborted) host.log.warn('居民连接暂不可用', {error: e.name});
        failed = true;
      }
      await delay(failed ? 5000 : 2000, null, {signal}).catch(() => {});
    }
  }
  async stopPolling() {
    this.controller?.abort();
    await this.loop;
    this.controller = null; this.current = null; this.session = null;
  }
  async stop() {
    this.host = null;
    this.account = null;
    this.pendingBirth = null;
    await this.stopPolling();
  }
}
