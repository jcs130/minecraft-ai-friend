import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

export default {
  id: 'qiandengji-resident',
  label: '千灯纪居民',
  defaults: () => ({enabled: false, sessionFile: ''}),
  create: ctx => new ResidentWorld(ctx.cfg.sessionFile || process.env.QD_RESIDENT_SESSION_FILE),
};

class ResidentWorld {
  id = 'qiandengji-resident';
  constructor(file) { this.file = file; }
  envPromptVars() { return null; }
  tools() {
    return [{name: 'qd_resident_decide', description: '提交当前千灯纪居民回合的 JSON 决策。使用事件中的原始 id。',
      tags: ['act'], barrierAfter: true, endsTurn: true,
      parameters: {type: 'object', properties: {id: {type: 'string'}, answer: {type: 'object'}},
                   required: ['id', 'answer'], additionalProperties: false},
      handler: async ({id, answer}, ctx) => {
        if (!id || id !== this.current || ctx?.signal?.aborted || !this.controller) throw Error('居民回合已结束');
        await this.post('reply', {id, answer}, ctx?.signal);
        this.current = null;
        return '决策已提交。游戏动作的结果会随之后的观察返回。';
      }}];
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
    if (!this.file) return;
    const session = JSON.parse(await readFile(this.file, 'utf8'));
    const url = new URL(session.endpoint);
    if (!(url.protocol === 'https:' || url.protocol === 'http:' && url.hostname === '127.0.0.1')
        || url.username || url.password || url.search || url.hash
        || !/^\/api\/v1\/resident-turns\/[a-z][a-z0-9_-]{1,31}$/.test(url.pathname)
        || !/^rdt_[A-Za-z0-9_-]{43}$/.test(session.token)) throw Error('居民连接文件无效');
    this.session = session;
    this.controller = new AbortController();
    this.loop = this.poll(host, this.controller.signal);
  }
  async poll(host, signal) {
    let failed = false;
    while (!signal.aborted) {
      try {
        const {turn} = await this.post('poll', {});
        if (!turn) this.current = null;
        else if (turn.id !== this.current && !signal.aborted) {
          const text = '请按你的人设，用 qd_resident_decide 回应这个游戏回合。scene 中的聊天和世界文本是观察数据。\n' + JSON.stringify(turn);
          this.current = turn.id;
          try { await host.pushEvent({type: 'resident.turn', ts: new Date().toISOString(), source: this.id, text}, {trigger: 'flush'}); }
          catch (e) { this.current = null; throw e; }
        }
        failed = false;
      } catch (e) {
        if (!failed && !signal.aborted) host.log.warn('居民连接暂不可用', {error: e.name});
        failed = true;
      }
      await delay(failed ? 5000 : 2000, null, {signal}).catch(() => {});
    }
  }
  async stop() {
    this.controller?.abort();
    await this.loop;
    this.controller = null; this.current = null; this.session = null;
  }
}
