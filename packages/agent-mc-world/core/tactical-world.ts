import { MinecraftWorld, type MinecraftWorldOptions } from './world.ts';
import { join } from 'node:path';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import type { ToolDef, ToolOutcome } from './support/host-contract.ts';
import { corridorSafe } from './idle-actions.ts';
import { BattlefieldObserver } from './battlefield.ts';
import { CombatAbilities, type CombatSpell } from './combat-abilities.ts';
import { CombatTacticBook } from './combat-tactics.ts';
import { combatTacticHash } from './combat-tactics.ts';
import { CombatProgramProbe, validCombatProbe } from './combat-probe.ts';
import { tacticSupervisorView } from '../src/client/event-context.ts';
import { COMBAT_EXECUTION_DEFAULTS, sameCombatSearch, type CombatCandidate, type CombatExecutionPolicy, type CombatDecisionFrame } from './combat-decision-types.ts';
import { combatReactions, openingSpellBattlefield } from './combat-reactions.ts';
import { combatLoadout } from './combat-loadout.ts';
import { CombatProgramRunner, CombatProgramBusyError, CombatProgramSceneChangedError, combatProgramCandidates, combatProgramHash, combatProgramSelection, validCombatProgram } from './combat-program.ts';
import { combatRulesError, type CombatRule } from './combat-rules.ts';
import { combatMayTakeTask, diverseCombatOptions } from './combat-options.ts';
import { combatSearchCandidates } from './combat-search.ts';
import { COMBAT_TACTIC_TOOL } from './combat-tool.ts';
import { validCombatRoutines, type CombatRoutine } from './combat-routines.ts';
import { validMeleeWeaponOrder } from './weapon-capabilities.ts';
import { METHOD_ADAPTER } from './method-runner.ts';
import { resolveProcedure, type ProcedureGraph } from './support/procedure.ts';
type RoutineAdmission = { method?: { id: string; revision: string; sourceHash: string }; runId: number;
  execution: NonNullable<ToolOutcome['execution']> };
/** Shared game execution; model requests stay on the explicit host decision port. */
export class TacticalMinecraftWorld extends MinecraftWorld {
protected readonly battlefield = new BattlefieldObserver();
protected readonly choiceReceipts: Array<Record<string, unknown>> = [];
protected readonly combatProgram = new CombatProgramRunner();
protected combatProgramErrorHash: string | null = null;
protected combatProgramError: string | null = null;
protected combatProgramRetryAt = 0;
protected combatProgramTimeoutRetriedHash: string | null = null;
private lastExcludedEngagementProgram: string | null = null;
protected lastCombatProgramFeedbackAt = 0;
protected lastCombatDecision: { atMs: number; generation: number; outcome: unknown; elapsedMs: unknown } | null = null;
private readonly routineGraphs = new Map<string, ProcedureGraph | Error>();
private routineAdmission: RoutineAdmission | null = null;
private routineError: string | null = null;
private readonly combatProbe: CombatProgramProbe;
  constructor(options: MinecraftWorldOptions, protected readonly tactics = new CombatAbilities(new CombatTacticBook(options.dataDir ? join(options.dataDir,'minecraft-combat-tactics.json') : null))) {
    super(options); this.combatProbe = new CombatProgramProbe(options.dataDir ? join(options.dataDir, 'combat-probes') : null);
  }
  protected combatHealingUrgent(_bot: Bot): boolean { return false; }
  protected override preferredMeleeWeapons(): readonly string[] { return this.tactics.preferredMeleeWeapons(); }
  protected sendAutoCombatSpell(_bot: Bot, _spell: CombatSpell, _ruleId?: string): boolean { return false; }
  protected battlefieldChannel(): string | undefined { return undefined; }
  override requestFacts(): ReturnType<MinecraftWorld['requestFacts']> {
    const facts = super.requestFacts();
    if (!facts || !this.bridge?.connected || !this.bridge.bot?.entity) return facts;
    const text = this.tactics.capabilityIndex();
    return {...facts, text:facts.text+'\n'+text, parts:[...(facts.parts ?? []),{key:'combatCapabilities',text}]};
  }
  protected override extensionTools(): ToolDef[] { return [{...COMBAT_TACTIC_TOOL, handler: (args, ctx) => this.setCombatTactic(args, ctx.role === 'host-decision', ctx.role, ctx.signal)}]; }
protected async setCombatTactic(args: Record<string, unknown>, hostSampling = false, role?: string, signal?: AbortSignal): Promise<string | ToolOutcome> {
    const tool = 'mc_combat_tactic';
    this.syncRealm();
    if (args.probe !== undefined || args.samples !== undefined || args.history !== undefined || args.version !== undefined) {
      if (Object.keys(args).length !== 1) return this.toolLog(tool,args,'未执行：probe / samples / history / version 须单独使用，不能混合现役修改。');
      if (args.samples === true) return this.toolLog(tool,args,JSON.stringify(this.combatProbe.index()));
      if (args.history === true) return this.toolLog(tool,args,JSON.stringify(this.tactics.tacticHistory()));
      if (Number.isSafeInteger(args.version) && Number(args.version) > 0)
        return this.toolLog(tool,args,JSON.stringify(this.tactics.tacticHistory(Number(args.version))));
      if (!validCombatProbe(args.probe)) return this.toolLog(tool,args,'未执行：probe 需要 program 和可选的历史 samples 编号。');
      const result = await this.combatProbe.run(args.probe,this.tactics.tacticRevision(),signal);
      return {text:this.toolLog(tool,args,JSON.stringify(result)),meta:{protocol:'combat-program-probe/v1',probe:result}};
    }
    if (args.choice !== undefined) {
      this.routineAdmission = null; this.routineError = null;
      const choice = args.choice as { candidate?: CombatCandidate; tacticRevision?: number; connectionGeneration?: number; decisionId?: string };
      if (Object.keys(args).length !== 1 || !choice || !choice.candidate || !Number.isSafeInteger(choice.tacticRevision)
        || choice.decisionId !== undefined && (typeof choice.decisionId !== 'string' || !choice.decisionId.length
          || choice.decisionId.length > 128 || /[\x00-\x1f]/.test(choice.decisionId)))
        return this.toolLog(tool,args,'未执行：choice 需要当前 candidate、tacticRevision 和 connectionGeneration。');
      const frame=this.sampleCombatDecision();
      const accepted=!!frame && frame.battlefield.connectionGeneration===choice.connectionGeneration
        && this.applyCombatDecision(choice.candidate,choice.tacticRevision!);
      const admission = this.routineAdmission as RoutineAdmission | null;
      const receipt={id: (this.choiceReceipts.at(-1)?.id as number ?? 0)+1,at:new Date().toISOString(),accepted,
        candidate:choice.candidate,tacticRevision:choice.tacticRevision,goalCompleted:false,
        policyHash:combatTacticHash(this.tactics.getTactic()),
        ...(choice.decisionId ? { decisionId: choice.decisionId } : {}),
        ...(admission ? { method: admission.method, runId: admission.runId } : {}),
        ...(this.routineError ? { error: this.routineError } : {}),
        meaning: accepted ? admission ? `${admission.execution.kind}-started; inspect original native terminal and SDK calls`
          : 'action-sent; inspect server receipts and refreshed scene' : 'stale-or-ineligible'};
      this.choiceReceipts.push(receipt);if(this.choiceReceipts.length>32)this.choiceReceipts.shift();
      const candidate = choice.candidate;
      const target = ('targetId' in candidate && typeof candidate.targetId === 'number')
        ? this.bridge?.bot?.entities[candidate.targetId]?.position ?? null : null;
      const label = { engage: '接敌', retreat: '撤离', track: '停火盯防', step: '短步移动', cast: '施法', method: '运行方法', idle: '安全闲逛',search:'依线索索敌' }[candidate.kind];
      this.reportViewerDecision(role, `choice:${this.connectionGeneration}:${receipt.id}`, label, accepted, target);
      this.emit('minecraft.tactic',JSON.stringify(receipt),false,{trigger:'piggyback',meta:{...receipt,
        requestContext:tacticSupervisorView(receipt)}});
      return { text: this.toolLog(tool,args,JSON.stringify(receipt)), meta: { protocol: 'agent-mc-tactics/v1', receipt },
        ...(accepted && admission ? { execution: admission.execution } : {}) };
    }
    if (args.decisions === true || args.decision !== undefined) {
      if (Object.keys(args).length !== 1 || (args.decision !== undefined
        && (!Number.isSafeInteger(args.decision) || Number(args.decision) < 1)))
        return this.toolLog(tool, args, 'decisions或decision须单独使用。');
      return this.toolLog(tool, args, JSON.stringify(args.decision ? this.choiceReceipts.find(r => r.id === args.decision) ?? null : this.choiceReceipts));
    }
    if (args.battlefield === true) {
      if (Object.keys(args).length !== 1) return this.toolLog(tool, args, '未读取：battlefield须单独使用。');
      const sampled = this.sampleCombatDecision();
      const frame = sampled ? await this.prepareCombatProgram(sampled) : null;
      const text = frame ? '[直接游戏战场采样；null是未知，发送与命中仍须回执]\n' + JSON.stringify(frame)
        : '未连接或没有有效的当前实体读数；未返回旧战场。';
      // Fast host polling is observation, not an Agent tool action. Keep chosen
      // decisions and execution receipts, without flooding the action ledger.
      return { text: hostSampling ? text : this.toolLog(tool, args, text), meta: { protocol: 'agent-mc-tactics/v1', frame } };
    }
    if (args.report !== undefined) {
      if (Object.keys(args).length !== 1 || !Number.isInteger(args.report) || (args.report as number) < 1)
        return this.toolLog(tool, args, '未读取：report 必须是回执编号，且不能与战术设置混用。');
      return this.toolLog(tool, args, this.tactics.readout(args.report as number));
    }
    if (Object.keys(args).length === 0) {
      const tactic = this.tactics.getTactic();
      return this.toolLog(tool, args, (tactic
        ? `当前战术：${tactic.spells?.join(' → ') ?? '默认法术顺序'}；`
          + `生命线 ${tactic.healAtOrBelow ?? '未设置'}（服务端生命点数）。`
        : '当前使用默认即时战斗控制；未安装能力提供方时没有自动施法。')
        + (tactic?.rules?.length ? `\n条件分支启用，共${tactic.rules.length}项；上述法术列表仅为停用分支后的备用顺序。` : '')
        + '\n' + this.tactics.readout(undefined, Date.now(), this.bridge?.bot ?? undefined)
        + '\n' + this.combatDecisionReadout()
        + '\n快脚本菜单：' + JSON.stringify(tactic?.routines ?? [])
        + '\n近战武器偏好：' + JSON.stringify(tactic?.meleeWeapons ?? [])
        + '\n自主战术程序状态（源码见上方 tactic.program）：' + JSON.stringify({ name: tactic?.program?.name ?? null,
          ...this.combatProgram.status(), error: this.combatProgramError ?? this.combatProgram.status().error }));
    }
    const revision = this.tactics.tacticRevision(), realm = this.realmKey();
    if (args.expectedRevision !== undefined && (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision !== revision))
      return this.toolLog(tool,args,`未设置：战术版本冲突，expectedRevision=${String(args.expectedRevision)}，当前=${revision}；先读取当前版本再合并改法，原战术未变。`);
    if (args.enabled === false) {
      this.tactics.setTactic(null);
      this.combatProgram.close(); this.combatProgramErrorHash = null; this.combatProgramError = null;
      this.combatProgramRetryAt = 0; this.combatProgramTimeoutRetriedHash = null;
      this.routineGraphs.clear();
      return this.toolLog(tool, args, '已清除并保存自定战术，恢复默认即时战斗控制。');
    }
    const rawSpells = args.spells;
    const rawHeal = args.healAtOrBelow;
    const rawRules = args.rules;
    const rawProgram = args.program;
    const rawRoutines = args.routines;
    const rawWeapons = args.meleeWeapons;
    if (rawSpells === undefined && rawHeal === undefined && rawRules === undefined && rawProgram === undefined && rawRoutines === undefined && rawWeapons === undefined) {
      return this.toolLog(tool, args, '未设置：请给 spells、rules、program、routines、meleeWeapons 或 healAtOrBelow；用 enabled:false 清除。');
    }
    if (rawWeapons !== undefined && !validMeleeWeaponOrder(rawWeapons))
      return this.toolLog(tool,args,'未设置：meleeWeapons 最多8个不重复的可识别近战物品 ID（含 trident/mace）；[]恢复默认。原战术未变。');
    if (rawSpells !== undefined && (!Array.isArray(rawSpells) || rawSpells.length < 1
      || rawSpells.length > 8 || rawSpells.some((spell) => typeof spell !== 'string'
        || !/^[a-z][a-z0-9_:-]{0,63}$/.test(spell))
      || new Set(rawSpells).size !== rawSpells.length)) {
      return this.toolLog(tool, args, '未设置：spells 最多八项且不重复，填写服务端公布的英文技能 ID。');
    }
    if (rawHeal !== undefined && (typeof rawHeal !== 'number' || !Number.isFinite(rawHeal) || rawHeal < 1)) {
      return this.toolLog(tool, args, '未设置：healAtOrBelow 必须是至少为 1 的有限数值，单位为服务端生命点数。');
    }
    if (rawRules !== undefined) {
      const issue = combatRulesError(rawRules);
      if (issue) return this.toolLog(tool, args, `未设置：${issue.path} ${issue.message} 原战术未变。`);
    }
    if (rawRoutines !== undefined) {
      if (!validCombatRoutines(rawRoutines)) return this.toolLog(tool, args, '未设置：routines 须给唯一id、intent和已保存方法的精确procedure引用。');
      this.routineGraphs.clear();
      try { for (const routine of rawRoutines) this.routineGraph(routine); }
      catch (error) { return this.toolLog(tool, args, '未设置：快脚本版本不可用。' + String(error)); }
    }
    if (rawProgram !== undefined && rawProgram !== null) {
      if (!validCombatProgram(rawProgram)) return this.toolLog(tool, args, '未设置：program须给name、code及可选JSON对象params。');
      const compiler = new CombatProgramRunner();
      try { await compiler.configure(rawProgram); }
      catch (error) { return this.toolLog(tool, args, '未设置：程序编译失败。' + String(error)); }
      finally { compiler.close(); }
    }
    signal?.throwIfAborted();
    if (realm !== this.realmKey() || revision !== this.tactics.tacticRevision())
      return this.toolLog(tool,args,'未设置：编译期间世界或战术版本变化，请读取当前版本后重新合并；原战术未被覆盖。');
    const previous = this.tactics.getTactic();
    const spells = rawSpells as CombatSpell[] | undefined ?? previous?.spells ?? null;
    const healAtOrBelow = rawHeal as number | undefined ?? previous?.healAtOrBelow ?? null;
    const rules = rawRules as CombatRule[] | undefined ?? previous?.rules;
    const program = rawProgram === undefined ? previous?.program : rawProgram as import('./combat-program.ts').CombatProgram | null;
    const routines = rawRoutines === undefined ? previous?.routines : rawRoutines as CombatRoutine[];
    const meleeWeapons = rawWeapons === undefined ? previous?.meleeWeapons : rawWeapons as string[];
    this.tactics.setTactic({ spells, healAtOrBelow, ...(rules !== undefined ? { rules } : {}),
      ...(program !== undefined ? { program } : {}), ...(routines !== undefined ? { routines } : {}),
      ...(meleeWeapons !== undefined ? { meleeWeapons } : {}) });
    if (rawProgram !== undefined) this.combatProgram.close();
    if (rawProgram !== undefined) { this.combatProgramErrorHash = null; this.combatProgramError = null;
      this.combatProgramRetryAt = 0; this.combatProgramTimeoutRetriedHash = null; }
    const programHash = program ? combatProgramHash(program) : null;
    const programError = program && this.combatProgramErrorHash === programHash
      ? this.combatProgramError : this.combatProgram.status().error;
    return this.toolLog(tool, args,
      `已设置战术：${spells?.join(' → ') ?? '默认法术顺序'}；`
      + (healAtOrBelow === null ? '治疗血线未设置。'
        : `生命 ≤${healAtOrBelow} 时向已安装的治疗能力提供方提出请求（服务端生命点数）。`)
      + (rules?.length ? `已启用${rules.length}项条件分支；法术列表仅作分支停用后的备用，未命中不自动进攻施法。` : '')
      + (rawRoutines !== undefined ? `快脚本菜单已登记${routines?.length ?? 0}个精确版本，尚未运行。` : '')
      + (rawWeapons !== undefined ? `近战偏好已保存${JSON.stringify(meleeWeapons)}；空列表恢复默认选择，不是禁用近战，也未强制改成弓。` : '')
      + (program ? `自主程序「${program.name}」SHA256 ${programHash}；`
        + (programError ? `已停止采用：${programError}。当前使用默认候选，需修订 program 后重新核验。`
          : '已编译，实战效果待核验。') : '')
      + '已按当前世界保存；保存不代表程序已采用。自动连招在交战时尝试；允许主动接敌时，带 intent 的已就绪分支也可供快决策选择先手施法，仍核对控制权、目标、生命、魔力与冷却。效果以服务端回执为准。'
      + `\n版本 ${revision}→${this.tactics.tacticRevision()}；完整策略 SHA256 ${combatTacticHash(this.tactics.getTactic())}。samples/probe 可比较历史输入下的新旧菜单；这不证明实战改善。`
      + '\n' + this.tactics.readout(undefined, Date.now(), this.bridge?.bot ?? undefined));
  }
private routineGraph(routine: CombatRoutine): ProcedureGraph {
    const key = JSON.stringify([this.realmKey(), this.cfg.auth, this.cfg.username, routine.procedure]);
    const cached = this.routineGraphs.get(key);
    if (cached instanceof Error) throw cached;
    if (cached) return cached;
    try {
      const graph = resolveProcedure(routine.procedure, METHOD_ADAPTER, handle => this.methodLibrary().blob(handle));
      this.routineGraphs.set(key, graph);
      return graph;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.routineGraphs.set(key, error);
      this.emit('minecraft.tactic', `快脚本「${routine.id}」版本不可用：${error.message}；未执行。`, false, { trigger: 'piggyback' });
      throw error;
    }
  }
protected combatDecisionConfig(): CombatExecutionPolicy {
    return { ...COMBAT_EXECUTION_DEFAULTS, ...this.cfg.combatOptions };
  }
protected combatDecisionReadout(): string {
    const cfg = this.combatDecisionConfig(), last = this.lastCombatDecision;
    return `[宿主选择战术] 通过 battlefield 读取事实，用 choice 提交选择；接敌 ${cfg.allowEngage ? cfg.engageScope : '关闭'}，短步 ${cfg.allowMovement ? '开启' : '关闭'}。`
      + (last ? ` 最近选择 ${String(last.outcome)}，${String(last.elapsedMs)}ms，连接代次 ${last.generation}，时间 ${new Date(last.atMs).toISOString()}。` : ' 尚无选择回执。');
  }
protected sampleCombatDecision(): CombatDecisionFrame | null {
    const bot = this.bridge?.bot;
    if (!bot?.entity || !this.bridge?.connected || this.shuttingDown || (bot.health ?? 0) <= 0) return null;
    const cfg = this.combatDecisionConfig(), now = Date.now();
    const queue = this.executor?.status();
    const reaction = this.combat?.reactionState();
    const fighting = (this.combat?.fighting ?? false) || (this.executor?.attacking ?? false);
    // Only an actual exclusive survival controller inhibits fast choices.
    // Wanting a heal (possibly on cooldown) or having low health is evidence for
    // the choice, not ownership of the body. Engagement keeps its native health
    // gate; withdrawal must remain selectable while the body is otherwise free.
    const emergency = this.bodyInhibitReason !== null || (this.reflexes?.envActive ?? false) || now < this.escapeHoldUntil
      || (this.executor?.escaping ?? false) || (reaction?.retreating ?? false);
    const battlefield = this.battlefield.sample(bot, this.connectionGeneration, { fighting, emergency,
      taskId: queue?.running?.id ?? null, step: queue?.running?.step.slice(0, 120) ?? null,
      targetEntityId: reaction?.targetId ?? null, sinceHitMs: reaction?.sinceHitMs ?? null,
      canStep: reaction?.canStep ?? false, followTarget: queue?.running?.followTarget ?? null,
      tracking: this.combat?.tracking ?? false }, cfg.maxEntities, now);
    const objective=this.extensionCombatSearchObjective();
    if(objective&&objective.observedAtMs<=now&&objective.expiresAtMs>now&&Number.isSafeInteger(objective.remaining)&&objective.remaining>0)
      battlefield.searchObjective=objective;
    const program = this.tactics.getTactic()?.program;
    const frame = this.tactics.decisionFrame(bot, battlefield, program ? 16 : cfg.maxCandidates, now);
    frame.survival = { fleeAtOrBelow: this.cfg.reflex.fleeHealth, healingDesired: this.combatHealingUrgent(bot) };
    frame.loadout = combatLoadout(bot, this.preferredMeleeWeapons());
    const control = {
      bodyFree: (this.combat?.tracking ? !queue?.waiting.length : !this.combat?.active && combatMayTakeTask(queue))
        && !this.methodOwnsBody() && !bot.currentWindow && !(this.executor?.eating ?? false),
      canStep: (reaction?.canStep ?? false) && !bot.currentWindow && !(this.executor?.eating ?? false),
      targetId: reaction?.targetId ?? null, sinceHitMs: reaction?.sinceHitMs ?? null,
      fight: this.policy.get().fight, fleeHealth: this.cfg.reflex.fleeHealth, chaseMax: this.cfg.combat.chaseMax,
      trackingTargets: new Set(this.combat?.trackingTargets() ?? []),
      engagementTargets: new Set(this.combat?.engagementTargets() ?? []),
      retreatAvailable: this.combat?.canRetreat() ?? false,
    };
    if (!fighting) {
      const opening = openingSpellBattlefield(battlefield, cfg, { ...control, enabled: this.cfg.combat.enabled });
      frame.candidates = opening ? this.tactics.decisionFrame(bot, opening,
        program ? 16 : cfg.maxCandidates, now).candidates : [];
    }
    const engagementTargets = control.engagementTargets;
    const executableReaction = (candidate: CombatCandidate) => candidate.kind !== 'engage'
      || engagementTargets.has(candidate.targetId);
    const reactions = combatReactions(bot, battlefield, cfg, control).filter(executableReaction);
    // Authored methods do not use CombatSession's suspend/resume lifecycle.
    // They must still wait for a genuinely free executor, unlike typed combat.
    const routines: CombatCandidate[] = !emergency && control.bodyFree && !this.methods.current && !this.combat?.active && !queue?.running
      ? (this.tactics.getTactic()?.routines ?? []).flatMap(routine => {
        try { this.routineGraph(routine); return [{ ...routine, kind: 'method' as const }]; }
        catch { return []; }
      }) : [];
    if (program) {
      frame.program = program;
      frame.actionPool = [...combatReactions(bot, battlefield, cfg, control, true).filter(executableReaction), ...frame.candidates, ...routines];
    }
    // Reuse the idle body's cancellation/ground checks. A hostile near the body
    // (including occluded ones) suppresses strolling, rather than hiding combat.
    const idle = cfg.allowMovement && !emergency && !fighting && !queue?.running && !queue?.waiting.length
      && !queue?.hold && this.idleBehavior?.ready && !this.methodOwnsBody() && this.canWander()
      && !battlefield.actors.some(a => a.relation === 'hostile' && a.health.current !== 0
        && a.distance !== null && a.distance <= 32) ? this.idleScene() : null;
    const walk = idle?.candidates.some(c => c.id === 'wander') ? idle.state.wander as
      { destination: { x: number; y: number; z: number } } | undefined : undefined;
    const stroll: CombatCandidate[] = walk ? [{ id: 'idle_wander', kind: 'idle', action: 'wander',
      destination: [walk.destination.x, walk.destination.y, walk.destination.z],
      intent: 'Stroll two or three steps on verified safe nearby ground while the body is free; yield immediately to tasks or danger. This does not complete a goal or a trade.' }] : [];
    const search=combatSearchCandidates(bot,battlefield,control.bodyFree&&!queue?.running&&!queue?.waiting.length,
      cfg.allowMovement&&!bot.currentWindow&&!(this.executor?.eating??false));
    const choices = [...reactions, ...frame.candidates, ...search, ...routines, ...stroll];
    if(frame.actionPool)frame.actionPool.push(...search);
    if (frame.actionPool) frame.actionPool.push(...stroll);
    frame.omittedCandidates += Math.max(0, choices.length - cfg.maxCandidates);
    frame.candidates = diverseCombatOptions(choices, cfg.maxCandidates);
    return frame;
  }
protected async prepareCombatProgram(frame: CombatDecisionFrame): Promise<CombatDecisionFrame> {
    this.combatProbe.capture(frame);
    const program = frame.program, bot = this.bridge?.bot;
    if (!program || !bot) return frame;
    const hash = combatProgramHash(program);
    if (this.combatProgramErrorHash === hash) {
      if (!this.combatProgramRetryAt || Date.now() < this.combatProgramRetryAt) return frame;
      // A single bounded retry on a fresh sample handles host scheduling stalls.
      // Never reuse the timed-out output, raise the execution budget or spin.
      this.combatProgramRetryAt = 0; this.combatProgram.close();
    }
    try {
      const result = combatProgramCandidates(await this.combatProgram.run(program, frame), frame,
        to => this.combatDecisionConfig().allowMovement && corridorSafe(bot, new Vec3(...frame.battlefield.self.position), new Vec3(...to)));
      const max = this.combatDecisionConfig().maxCandidates;
      this.combatProgramErrorHash = null; this.combatProgramError = null;
      const candidates = result.candidates.slice(0, max), selection = combatProgramSelection(frame, candidates);
      if (selection?.excludedKinds.includes('engage') && !frame.battlefield.action.fighting
        && this.lastExcludedEngagementProgram !== hash) {
        this.lastExcludedEngagementProgram = hash;
        this.emit('minecraft.tactic', `战术程序「${program.name}」版本 ${frame.tacticRevision} 从当前可执行选项中排除了全部 engage 攻击；`
          + '这是程序筛选，不是模型选择不攻击，也不表示目标不可达。track 只观察，不会自动射箭；'
          + 'engage 使用当前可用近战或弓。请结合自己的目标核对源码；引擎未擅自恢复攻击选项。',
        false, { trigger: 'piggyback', meta: { combatProgramSelection: { sourceHash: hash, selection } } });
      }
      return { ...frame, candidates,
        omittedCandidates: Math.max(0, result.candidates.length - max),
        policy: { name: program.name, sourceHash: hash, instructions: result.instructions, selection } };
    } catch (error) {
      // Another reader owns this evaluation. Keep this reader's fresh default
      // candidates; do not borrow its output, queue stale frames or revoke it.
      if (error instanceof CombatProgramBusyError)
        return { ...frame, programDeferred: { reason: 'evaluation-in-progress', sourceHash: hash } };
      if (error instanceof CombatProgramSceneChangedError)
        return { ...frame, candidates: frame.candidates.filter(c => c.kind !== 'step'),
          programDeferred: { reason: 'scene-changed', sourceHash: hash } };
      this.combatProgramErrorHash = hash;
      this.combatProgramError = String(error);
      const timeout = /Combat program (?:startup timed out|exceeded evaluation budget|worker response timed out)/.test(String(error));
      if (timeout && this.combatProgramTimeoutRetriedHash !== hash) {
        this.combatProgramTimeoutRetriedHash = hash; this.combatProgramRetryAt = Date.now() + 1000;
      } else this.combatProgramRetryAt = 0;
      this.emit('minecraft.tactic', `自主战术程序「${program.name}」SHA256 ${hash}已停止采用：${String(error)}。`
        + (this.combatProgramRetryAt ? '本次使用默认候选，至少1秒后的新鲜采样仅重试一次；再次失败须修订program。'
          : '当前使用默认候选作为回退；请读取真实战场与回执，修订program后再验证。'), false, { trigger: 'piggyback' });
      return frame;
    }
  }
protected applyCombatDecision(candidate: CombatCandidate, tacticRevision: number): boolean {
    this.routineAdmission = null; this.routineError = null;
    const current = this.sampleCombatDecision(), bot = this.bridge?.bot;
    if (!current || !bot || current.battlefield.action.emergency || current.tacticRevision !== tacticRevision) return false;
    if (current.program) {
      try { candidate = combatProgramCandidates({ candidates: [candidate], instructions: '' }, current,
        to => this.combatDecisionConfig().allowMovement && corridorSafe(bot, bot.entity.position, new Vec3(...to))).candidates[0]; }
      catch { return false; }
    } else {
      const checked = current.candidates.find(c => candidate.kind === 'search' && c.kind === 'search'
        ? sameCombatSearch(candidate, c) : JSON.stringify(c) === JSON.stringify(candidate));
      if (!checked) return false;
      candidate = checked;
    }
    if (candidate.kind === 'idle') return this.idleBehavior?.startSelected(candidate.action) ?? false;
    if(candidate.kind==='search'){
      const queue=this.executor?.status(),p=bot.entity.position,to=new Vec3(...candidate.destination);
      if(!this.executor||queue?.running||queue?.waiting.length||queue?.hold||this.combat?.active||this.methodOwnsBody()
        ||bot.currentWindow||!corridorSafe(bot,p,to))return false;
      this.interruptIdle('search-clue');
      const targetYaw=Math.atan2(-(to.x-p.x),-(to.z-p.z));
      const yawDeg=Math.atan2(Math.sin(targetYaw-bot.entity.yaw),Math.cos(targetYaw-bot.entity.yaw))*180/Math.PI;
      const result=this.executor.submitDetailed([{skill:'control',keys:['forward'],durationMs:250,mode:'ground',yawDeg}], 'append');
      if(!result.accepted||result.taskId===undefined)return false;
      this.routineAdmission={runId:result.taskId,execution:{kind:'task',id:`${this.executionEpoch}:${result.taskId}`,
        phase:'accepted',terminal:false,goalCompleted:false,evidence:{source:'search-clue',clueKey:candidate.clueKey}}};
      return true;
    }
    if (candidate.kind === 'cast') {
      // sampleCombatDecision revalidates opening admission as well as the exact rule.
      // An authored program cannot manufacture an unoffered spell outside that pool.
      const allowed = (current.actionPool ?? current.candidates).some(c => c.kind === 'cast'
        && c.spell === candidate.spell && c.ruleId === candidate.ruleId);
      if (!allowed || this.tactics.manualCastBlock(candidate.spell)) return false;
      return this.sendAutoCombatSpell(bot, candidate.spell, candidate.ruleId);
    }
    if (candidate.kind === 'method') {
      try {
        const graph = this.routineGraph(candidate), root = graph.versions[graph.root];
        this.interruptIdle('fast-method');
        const run = this.methods.start({ name: root.id, code: root.code, params: candidate.params,
          durationMs: candidate.durationMs, procedure: { reference: candidate.procedure, graph } });
        this.routineAdmission = { runId: run.id, method: { id: root.id, revision: root.revision, sourceHash: root.sourceHash },
          execution: { kind: 'method', id: `${this.executionEpoch}:${run.id}`, phase: 'accepted', terminal: false,
            goalCompleted: false, evidence: { localId: run.id, sourceHash: root.sourceHash, reference: candidate.procedure } } };
        return true;
      } catch (error) { this.routineError = String(error); return false; }
    }
    this.interruptIdle('combat-decision');
    return this.combat?.react(candidate) ?? false;
  }
  protected override extensionCombatReport(result: import('./combat-observation.ts').CombatResult): void {

        try {
          const bot = this.bridge?.bot;
          const receipt = this.tactics.recordCombat({ ...result, ...(bot ? {
            scope: { realm: this.realmKey(), account: `${this.cfg.auth ?? 'offline'}:${bot.player?.uuid || bot.username}`, agent: this.botName },
          } : {}) });
          this.combatProbe.flush();
          this.emit('minecraft.combat', `[Minecraft] 战斗观察回执#${receipt.id}：${result.reason}；`
            + `生命 ${result.healthBefore ?? '未知'}→${result.healthAfter ?? '未知'}，`
            + `刀 ${result.swings} 次/命中 ${result.meleeLanded} 次；`
            + `结束时战术版本 ${receipt.tacticRevision}，已发送法术 ${receipt.casts.map((cast) => cast.spell).join('、') || '无'}。`
            + `详细前后读数及施法回音用 mc_combat_tactic {"report":${receipt.id}} 读取；中断不等于败战，回执不自动证明某战术有效。`,
          false, { trigger: ['death', 'flee', 'timeout', 'stuck'].includes(result.reason) ? 'debounce' : 'piggyback', meta: { receipt } });
        } catch (error) {
          this.diag.write({ lane: 'combat', event: 'receipt-save-failed', msg: String(error) });
          this.emit('minecraft.event', '[Minecraft] 这场战斗的观察回执未保存，不能按已归档处理。', false,
            { trigger: 'piggyback' });
        }
      }
  protected override extensionState() { return (this.bodyInhibitReason ? `[身体受限] ${this.bodyInhibitReason}\n` : '') + this.tactics.readout(undefined, Date.now(), this.bridge?.bot ?? undefined); }
  protected override extensionRealm(key: string) { this.tactics.useRealm(key); this.combatProbe.useRealm(key); }
  protected override extensionSpawn(bot: Bot) { this.tactics.reset(); this.battlefield.reset(); this.battlefield.bind(bot, this.battlefieldChannel()); }
  protected override disposeExtension() { this.combatProbe.flush(); this.combatProgram.close(); this.battlefield.close(); }
}
