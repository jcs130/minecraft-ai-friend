import {
  parseCli, parseCastInput, cliOverview, cliAllCommands, cliVerbHelp, CLI_VERBS,
  shapeStatus, shapeSkills, shapeSpells, shapeInnate, canonicalVerb, type CliCommand,
} from '../gameplay/commands/player-cli.ts'
import { NATIVE_SPELL_ID } from '../gameplay/native/contracts.ts'
import type { PlayerCommandPorts, PlayerCommandRequest } from './player-command-ports.ts'

export const EXTENDED_PLAYER_COMMANDS = new Set(['pray', 'offering', 'ask', 'chat', 'summon'])

/** Deterministic player use cases. All side effects are supplied as ports;
 * there is no model, network, file, Bot or timer dependency in this module. */
export function createPlayerCommands(deps: PlayerCommandPorts) {
  const { magic, irons, rcon, worlddb, waypoints, waypointTravel, tpWaypoint,
    resolveLogin, skillBookItem, parseNbtPosition, queryNativeProgression,
    nativeProgressionLines, cliWhisper } = deps

  async function castUnified(subject: string, args: string[]): Promise<Record<string, any>> {
    const input = parseCastInput(args, magic.listAtoms(), subject.includes('-') ? [] : magic.getSkillbar(subject))
    if (!input.ok) return input
    const hasLegacyAlias = magic.listAtoms().some(atom => atom.words.some(word => word.toLowerCase() === input.skill.toLowerCase()))
    const native = NATIVE_SPELL_ID.test(input.skill) || (!magic.getAtomById(input.skill) && !hasLegacyAlias)
    if (native) {
      if (Object.keys(input.params).length) return { ok: false, code: 'invalid_params', summary: '铁魔法的等级与威力由装备决定，不接受额外施法参数。' }
      return irons.cast(subject, input.skill)
    }
    if (subject.includes('-')) return { ok: false, code: 'login_required', summary: '旧秘术进度按登录名保存；请使用唯一登录名施放旧秘术。UUID 可用于原生铁魔法。' }
    const result = await magic.castExact(subject, input.skill, input.params)
    if (result.ok && result.skillId) {
      const atom = magic.getAtomById(result.skillId)
      deps.bubble?.show(subject, `「${atom?.words[0] ?? result.name ?? result.skillId}！」`)
    }
    return { ...result, ...(input.slot ? { slot: input.slot } : {}) }
  }

  async function handleCli(subject: string, replyTarget: string, cmd: CliCommand, isGuardian = false,
    capture?: (result: Record<string, unknown>) => void): Promise<void> {
    // 回执路由分离（2026-08-23）：主体=主人（OWNER），回执=守护天使本身（sys_<owner>）。
    const reply = (text: string) => {
      if (capture) { capture({ ok: false, code: 'text_response', summary: text }); return }
      cliWhisper(replyTarget, text)
    }
    const replyLines = (lines: string[]) => { for (const ln of lines) reply(ln) }
    const jsonReply = (o: Record<string, unknown>) => {
      if (capture) { capture(o); return }
      cliWhisper(replyTarget, `[CLI] ${JSON.stringify(o)}`)
    }
    const fail = (code: string, summary: string) => {
      if (cmd.json) jsonReply({ ok: false, code, summary })
      else reply(`[CLI] ${summary}`)
    }
    if (cmd.error) {
      if (cmd.json) jsonReply({ ok: false, code: 'invalid_command', summary: cmd.error })
      else reply(`[CLI] ${cmd.error}`)
      return
    }
    if (cmd.wantHelp) {
      const lines = cliVerbHelp(cmd.verb)
      if (cmd.json) jsonReply({ ok: true, command: cmd.verb, help: lines })
      else replyLines(lines)
      return
    }

    // 鉴定 / appraise：resolveChant('鉴定') 命中 appraise atom → doAppraise（零命令原子）
    const doAppraiseCli = async (textArg?: string): Promise<void> => {
      const result = await magic.castExact(subject, 'appraise')
      if (cmd.json) jsonReply({ ...result })
      else reply(`[信使] ${result.summary}`)
    }

    if (EXTENDED_PLAYER_COMMANDS.has(cmd.verb)) {
      if (deps.extendedCommand) await deps.extendedCommand(subject, replyTarget, cmd, isGuardian, capture)
      else fail('integration_unavailable', '此命令需要的女神或守卫服务暂不可用；普通技能、状态与传送仍可使用。')
      return
    }

    switch (cmd.verb) {
      case 'commands': {
        if (cmd.json) jsonReply({ ok: true, commands: CLI_VERBS })
        else replyLines(cliAllCommands())
        return
      }
      case 'help': {
        const v = cmd.args[0] ?? ''
        const lines = v ? cliVerbHelp(canonicalVerb(v) ?? v) : cliOverview()
        if (cmd.json) jsonReply({ ok: true, help: lines })
        else replyLines(lines)
        return
      }
      case 'menu': {
        if (cmd.args[0] === 'irons' || cmd.args[0] === '铁魔法') {
          if (cmd.args.length !== 1) { fail('invalid_params', '用法：menu irons。'); return }
          const result = await irons.request('menu', subject)
          if (cmd.json) jsonReply(result)
          else if (!result.ok) reply(`[CLI] ${result.summary}`)
          return
        }
        const section = cmd.args[0] ?? ''
        if (cmd.args.length > 1 || (section && !['waypoints', 'archive', 'skillbar'].includes(section))) { fail('invalid_params', '用法：menu、menu irons、menu waypoints、menu archive 或 menu skillbar。'); return }
        let ok = false
        try {
          const pos = parseNbtPosition(await rcon.send(`data get entity ${resolveLogin(subject)} Pos`))
          if (pos) {
            if (section === 'skillbar') magic.getSkillbar(subject)
            const out = await rcon.send(section ? `skillchest ${section} ${resolveLogin(subject)} 0` : `execute as ${resolveLogin(subject)} at @s run skillchest self`)
            ok = !/unknown|incorrect|error|不在线|错误|未知|异常/i.test(out)
          }
        } catch { /* Return a failed request, never claim that a GUI opened. */ }
        if (cmd.json) jsonReply({ ok, code: ok ? 'menu_requested' : 'menu_unavailable', summary: ok ? '已请求打开技能轮盘。' : '角色不在线或界面暂不可用。' })
        else if (!ok) reply('[CLI] 轮盘未打开，请确认角色在线后重试。')
        return
      }
      case 'status': {
        const native = await irons.request('status', subject)
        const progression = await queryNativeProgression(rcon, subject)
        if (!native.ok && ['actor_not_found', 'ambiguous_actor'].includes(native.code)) { jsonReply({ ...native, progression }); return }
        if (subject.includes('-')) { jsonReply({ ...native, progression }); return }
        const view = magic.getState(subject)
        const innateName = magic.getInnate(subject)
        const { panel, json } = shapeStatus(view, innateName)
        const attrs = native.attributes as Record<string, number> | undefined
        if (cmd.json) { jsonReply({ ok: true, ...json, ...(native.ok ? { level: native.level, hp: attrs?.health, maxHp: attrs?.maxHealth } : {}), native, progression }); return }
        if (native.ok) reply(`[铁魔法] Lv.${native.level} · 生命 ${attrs?.health}/${attrs?.maxHealth} · 法力 ${native.mana}/${native.maxMana} · ${(native.casting as any)?.active ? '正在施法' : '就绪'}。`)
        else reply(`[铁魔法] ${native.summary}`)
        replyLines(nativeProgressionLines(progression))
        replyLines(panel.replace('魔力：', '秘术魔力：').split('\n').filter(line => !native.ok || (!line.startsWith('生命：') && !line.startsWith('✦ 状态')))); return
      }
      case 'skills': {
        const view = magic.getState(subject)
        const { panel, json } = shapeSkills(view, magic.listAtoms().filter(a => a.type !== 'passive' && (!a.catalog || a.catalog.status === 'featured')))
        if (cmd.json) {
          const bookSkills = magic.listAtoms().filter(a => a.type === 'passive' || !a.catalog || a.catalog.status === 'featured')
            .map(a => ({ id: a.id, name: a.name, requiredLevel: a.requiredLevel, type: a.type,
              learned: view.learned.includes(a.id) || view.innateSkill === a.id }))
          jsonReply({ ok: true, ...json, bookSkills }); return
        }
        replyLines(panel.split('\n')); return
      }
      case 'spells': {
        if (!cmd.args.length || ['irons', '铁魔法'].includes(cmd.args[0])) {
          if (cmd.args.length > 1) { fail('invalid_params', '用法：spells irons。'); return }
          const result = await irons.request('list', subject)
          if (cmd.json) jsonReply(result)
          else if (!result.ok) reply(`[铁魔法] ${result.summary}`)
          else {
            reply(`[铁魔法] 装备法术 ${result.spells?.length ?? 0} 个 · /mycli menu irons 选取施法；特色秘术查 spells legacy，旧档案查 spells archive。`)
            replyLines((result.spells ?? []).map(s => `${s.name} Lv.${s.level} · ${s.id} · 法力 ${s.mana} · 冷却 ${s.cooldownMs}ms`))
          }
          return
        }
        const scope = ['archive', '档案'].includes(cmd.args[0]) ? 'archive' : 'legacy'
        const named = ['legacy', 'archive', '档案'].includes(cmd.args[0])
        const pageArg = named ? cmd.args[1] : cmd.args[0]
        if (cmd.args.length > (named ? 2 : 1) || (pageArg && !/^[1-9]\d*$/.test(pageArg))) { fail('invalid_params', '用法：spells irons、spells legacy [页码] 或 spells archive [页码]。'); return }
        const page = pageArg ? Number(pageArg) : 1
        const atoms = magic.listAtoms().filter(a => scope === 'archive' ? a.catalog?.status === 'archived' : a.type !== 'passive' && (!a.catalog || a.catalog.status === 'featured'))
        const { panel, json } = shapeSpells(atoms, page, 12, scope)
        if (cmd.json) { jsonReply({ ok: true, ...json }); return }
        replyLines(panel.split('\n')); return
      }
      case 'discoveries': case '发现点': case '舆图': {
        // 探索者舆图（2026-08-29）：守卫远征自动登记的发现点一览；
        // 改名用法：/mycli 舆图 改名 <id> <新地名>（女神赐名权）
        const sub = cmd.args[0] ?? ''
        if (sub === '改名' || sub === 'rename') {
          const id = parseInt(cmd.args[1] ?? '', 10)
          const newName = cmd.args.slice(2).join(' ').trim()
          if (!id || !newName) { reply(`[CLI] 用法：/cli 舆图 改名 <id> <新地名>。`); return }
          const ok = worlddb.discoveryRename(id, newName.slice(0, 24))
          reply(ok ? `[CLI] 第 ${id} 处发现点已赐名「${newName}」。` : `[CLI] 没有第 ${id} 处发现点。`)
          return
        }
        const rows = worlddb.discoveryList()
        if (cmd.json) { jsonReply({ ok: true, count: rows.length, discoveries: rows }); return }
        if (!rows.length) { reply(`[CLI] 舆图还空着——守卫远征到新天地才会落笔。`); return }
        replyLines(rows.slice(0, 20).map((r) =>
          `#${r.id} ${r.name} (${Math.round(r.x)}, ${Math.round(r.z)}) by ${r.found_by}`))
        return
      }
      case 'skillbar': {
        // 技能栏（2026-08-30 造物主设计「圆盘可编辑+数字键快捷施法」）：
        //   /mycli skillbar            → 查看（json 模式带 icon，客户端 HUD 直用）
        //   /mycli skillbar set 1 圣愈术 → 第 1 槽放圣愈术（''=空槽占位）
        //   /mycli skillbar clear 3    → 清空第 3 槽
        //   /mycli skillbar auto      → 重置为推荐栏
        const sub = cmd.args[0] ?? ''
        const all = magic.listAtoms()
        const nameOf = (id: string) => all.find((x) => x.id === id)?.name ?? id
        const iconOf = (id: string) => all.find((x) => x.id === id)?.icon ?? 'minecraft:paper'
        const barView = (bar: string[]) => bar
          .map((id, i) => (id ? { slot: i + 1, id, name: nameOf(id), icon: iconOf(id) } : null))
          .filter((x): x is { slot: number; id: string; name: string; icon: string } => x !== null)
        const lineOf = (bar: string[]) => bar.map((id, i) => `${i + 1}=${id ? nameOf(id) : '空'}`).join(' ')
        const syncHud = async (bar: string[]) => {
          if (!deps.syncStaffBar) return { ok: false, code: 'staff_gate_unavailable', summary: '快捷栏界面暂不可用。' }
          const slots = Array.from({ length: 8 }, (_, i) => {
            const id = bar[i] ?? '', atom = all.find(a => a.id === id)
            return { slot: i + 1, id, name: id ? nameOf(id) : '', icon: id ? iconOf(id) : 'minecraft:paper',
              chant: atom ? `咏唱${atom.name}` : '' }
          })
          try { return await deps.syncStaffBar(subject, slots) }
          catch { return { ok: false, code: 'staff_gate_unavailable', summary: '快捷栏显示暂时无法同步。' } }
        }
        if (sub === 'sync') {
          if (cmd.args.length !== 1) { fail('invalid_params', '用法：skillbar sync。'); return }
          const result = await syncHud(magic.getSkillbar(subject))
          // Quiet HUD refresh; no repeated whispers while the staff is held.
          if (cmd.json) jsonReply(result)
          return
        }
        if (sub === 'set' || sub === 'clear') {
          const bar = magic.getSkillbar(subject)
          const slot = /^[1-8]$/.test(cmd.args[1] ?? '') ? Number(cmd.args[1]) : 0
          if (!slot || slot < 1 || slot > 8) { fail('invalid_slot', `用法：/mycli skillbar ${sub} <1-8>${sub === 'set' ? ' <法术名>' : ''}。`); return }
          while (bar.length < slot) bar.push('')
          if (sub === 'clear') { bar[slot - 1] = '' }
          else {
            const nameOrId = cmd.args.slice(2).join(' ').trim()
            const atom = all.find((a) => a.name === nameOrId || a.id === nameOrId)
            if (!atom) { fail('unknown_skill', `没有叫「${nameOrId}」的法术。/mycli spells 查表。`); return }
            if (atom.type === 'passive') { fail('passive', '被动能力自动生效，不占主动施法槽。'); return }
            if (atom.catalog?.status === 'archived') { fail('skill_archived', `「${atom.name}」已归档：${atom.catalog.reason}。/mycli spells irons 查看原生法术。`); return }
            const view = magic.getState(subject)
            const pool = [...view.learned, ...(view.innateSkill ? [view.innateSkill] : [])]
            if (!pool.includes(atom.id)) { fail('not_learned', `「${atom.name}」你还没学会，进不了技能栏。`); return }
            // Rebinding an already displayed skill moves it to the requested slot.
            // Otherwise the core duplicate filter would keep the earlier slot instead.
            for (let i = 0; i < bar.length; i++) if (bar[i] === atom.id) bar[i] = ''
            bar[slot - 1] = atom.id
          }
          const next = magic.setSkillbar(subject, bar)
          await syncHud(next)
          if (cmd.json) jsonReply({ ok: true, skillbar: barView(next) })
          else reply(`[信使] 技能栏：${lineOf(next) || '（空）'}`)
          return
        }
        if (sub === 'auto') {
          magic.setSkillbar(subject, [])            // 清自定义 → undefined
          const fresh = magic.getSkillbar(subject)  // 默认推荐填充
          await syncHud(fresh)
          if (cmd.json) jsonReply({ ok: true, skillbar: barView(fresh) })
          else reply(`[信使] 技能栏已重置：${lineOf(fresh)}`)
          return
        }
        if (sub) { fail('invalid_subcommand', 'skillbar 支持 set、clear、auto；不带参数查看。'); return }
        // 查看模式（默认；json 给客户端 HUD：icon 字段即物品图标）
        const bar = magic.getSkillbar(subject)
        if (cmd.json) { jsonReply({ ok: true, skillbar: barView(bar) }); return }
        if (!barView(bar).length) { reply(`[信使] 技能栏是空的——/mycli skillbar set <1-8> <法术名>，或 skillbar auto 一键推荐。`); return }
        replyLines([
          `[信使] 技能栏（数字键直放）：${lineOf(bar)}`,
          ...barView(bar).map((s) => `  ${s.slot}. ${s.name} = ${s.icon.replace('minecraft:', '')}`),
          `编辑：skillbar set <1-8> <法术名>｜清槽：clear <槽>｜重置：auto`,
        ])
        return
      }
      case 'cast': {
        const result = await castUnified(subject, cmd.args)
        if (cmd.json) jsonReply(result)
        else reply(`[信使] ${result.summary}`)
        return
      }
      case 'staff-cast': {
        if (cmd.args.length !== 1 || !/^[1-8]$/.test(cmd.args[0])) { fail('invalid_params', '言灵杖快捷技能需要 1 至 8 号技能槽。'); return }
        if (!deps.claimStaff) { fail('staff_gate_unavailable', '言灵杖服务暂不可用。'); return }
        let gate: Record<string, unknown>
        try { const at = deps.now(); gate = await deps.claimStaff(subject, at, at, Number(cmd.args[0])) }
        catch { fail('outcome_unknown', '未收到言灵手势回执，请松开后重新咏唱。'); return }
        if (gate.ok !== true || gate.code !== 'claimed') {
          const result = gate.ok === true ? { ok: false, code: 'gesture_required', summary: '请先举起言灵杖，再按快捷技能键。' } : gate
          if (cmd.json) jsonReply(result); else reply(`[言灵] ${result.summary}`)
          return
        }
        const result = await castUnified(subject, cmd.args)
        if (cmd.json) jsonReply(result); else reply(`[言灵] ${result.summary}`)
        return
      }
      case 'cancel': {
        if (cmd.args.length) { fail('invalid_params', '用法：/mycli cancel。'); return }
        const result = await irons.request('cancel', subject)
        if (cmd.json) jsonReply(result)
        else reply(`[铁魔法] ${result.summary}`)
        return
      }
      case 'bookget': {
        // 领取技能书（2026-08-29 造物主设计「命格书=技能仓库」：翻页领书 → 装备右键施法；
        // 命格书每技能页带【✦ 领取】链接，语音说一声也行——书丢了随时再领，不再占满背包）。
        if (!cmd.args.length) { reply(`[CLI] 用法：/cli 领书 <法术名>。已学会的法术随时可领。`); return }
        const name = cmd.args.join(' ').trim()
        const atom = magic.listAtoms().find((a) => a.name === name || a.id === name)
        if (!atom) { reply(`[CLI] 没有叫「${name}」的法术。/cli spells 查法术表。`); return }
        if (atom.catalog?.status === 'archived' && atom.type !== 'passive') { fail('skill_archived', `「${atom.name}」已归档：${atom.catalog.reason}`); return }
        const view = magic.getState(subject)
        if (!view.learned.includes(atom.id) && view.innateSkill !== atom.id) {
          reply(`[信使] 「${atom.name}」你还没学会，领不了书——先参悟或升级解锁。`)
          return
        }
        const r = await rcon.send(`give ${subject} ${skillBookItem(atom.name)} 1`).catch(() => '')
        if (!r || !/gave|已给予|Given/i.test(r)) { reply(`[信使] 书没递到你手上——人在线再领。`); return }
        worlddb.chronicleRecord('cast', subject, { skill: 'bookget', book: atom.name })
        reply(`[信使] ✦《${atom.name}》技能书已到手：拿在手上右键就是放。`)
        return
      }
      case 'learn': {
        // 持书参悟（2026-08-29 造物主设计「野外拾取的书用一次自动收录」）：
        // 校验背包里有 skillbook:<名> 的成书（书=历练凭证）→ learnViaAdvancement
        // 入册（绕等级门槛；施放仍走快路径等级闸）。命格书右键重写时自动收录成页。
        if (!cmd.args.length) { fail('usage', '用法：/mycli learn <技能ID或名称>；需要背包中已有对应的真实技能书。'); return }
        if (subject.includes('-')) { fail('login_required', '旧技能学习记录按登录名保存，请使用绑定身体的唯一登录名。'); return }
        const name = cmd.args.join(' ').trim()
        const atom = magic.listAtoms().find((a) => a.name === name || a.id === name)
        if (!atom) { fail('unknown_skill', `没有叫「${name}」的法术。`); return }
        if (atom.catalog?.status === 'archived' && atom.type !== 'passive') { fail('skill_archived', `「${atom.name}」已归档：${atom.catalog.reason}`); return }
        const view = magic.getState(subject)
        if (view.learned.includes(atom.id) || view.innateSkill === atom.id) {
          if (cmd.json) jsonReply({ ok: true, code: 'already_learned', skillId: atom.id,
            learned: true, summary: `「${atom.name}」已经学会。` })
          else reply(`[信使] 「${atom.name}」你早已学会，收录在命格书里了。`)
          return
        }
        // Server-side item predicate checks the actual component, rather than
        // finding a forged title/page containing "skillbook" in serialized NBT.
        // Reading UUID is a read-only success sentinel; no book or XP is granted.
        // inventory.* is only slots 9–35 in 1.21.1. container.* also includes
        // the hotbar (and held mainhand); offhand has its own equipment slot.
        let hasBook = false
        for (const slots of ['container.*', 'weapon.offhand']) {
          const proof = await rcon.send(`execute if items entity ${subject} ${slots} minecraft:written_book[minecraft:custom_data~{skillbook:${JSON.stringify(atom.name)}}] run data get entity ${subject} UUID`).catch(() => '')
          if (/\[I;\s*-?\d+,\s*-?\d+,\s*-?\d+,\s*-?\d+\]\s*$/.test(proof)) { hasBook = true; break }
        }
        if (!hasBook) {
          fail('skill_book_required', `参悟需要背包中已有《✦ ${atom.name}》技能书；没有对应书籍，未记录学习。`)
          return
        }
        magic.learnViaAdvancement(subject, atom.id)
        worlddb.chronicleRecord('cast', subject, { skill: 'learn', atom: atom.id, via: 'skillbook' })
        // 被动装备化（2026-08-30 造物主钦点）：type:passive 的法术参悟即装备——
        // 写 passives，效果引擎自动续杯（夜视/铁躯/疾风/鱼鳃/火衣），无需施放。
        const passiveId = (atom as { type?: string; passiveId?: string }).passiveId
        if ((atom as { type?: string }).type === 'passive' && passiveId) {
          magic.unlockPassive(subject, passiveId)
          worlddb.chronicleRecord('skill', subject, { passive: passiveId, via: 'learn' })
          if (cmd.json) jsonReply({ ok: true, code: 'learned', skillId: atom.id, learned: true,
            passive: passiveId, summary: `「${atom.name}」已通过已有技能书参悟并记录为被动。` })
          else reply(`[信使] 参悟成功——「${atom.name}」已融入你的身躯（被动·永久装备）：不用施放，效果常伴。`)
          return
        }
        if (cmd.json) jsonReply({ ok: true, code: 'learned', skillId: atom.id, learned: true,
          requiredLevel: atom.requiredLevel, canCastAtCurrentLevel: view.level >= atom.requiredLevel,
          summary: `「${atom.name}」已通过已有技能书收录；施放仍校验等级、魔力和冷却。` })
        else reply(`[信使] 参悟成功——「${atom.name}」已录入你的命格书！等级够就能放；书可留可丢，随时 /cli 领书 ${atom.name} 再取。`)
        return
      }
      case 'goto':
      case 'waypoint': {
        const location = await waypointTravel.location(resolveLogin(subject))
        if (!location.ok) { if (cmd.json) jsonReply(location); else reply(`[传送阵] ${location.summary}`); return }
        const owner = location.actor!
        const showList = () => {
          const entries = waypoints.listWithRefs(owner)
          const storage = waypoints.getStatus()
          if (!storage.available) { fail('waypoints_unavailable', '传送点簿暂不可用，原文件已保留；请检查存储报告。'); return }
          if (cmd.json) { jsonReply({ ok: true, entries, storage }); return }
          replyLines([`[传送阵] ${entries.length} 个地点；/mycli menu waypoints 可直接选择：`,
            ...entries.map(e => `  ${e.index}. ${e.waypoint.name} · ${e.scope === 'shared' ? '公共' : '个人'} · ${e.waypoint.dim} · ${e.ref}`),
            '记点：waypoint add <名字>；传送：goto <序号|完整名字|固定编号>；删除：waypoint remove personal:<id>。'])
        }
        try {
          if (cmd.verb === 'goto') {
            const query = cmd.args.join(' ').trim()
            if (!query) { showList(); return }
            const target = waypoints.resolve(owner, query)
            if (target.status !== 'found') {
              if (target.status === 'ambiguous') {
                const summary = '这个名字对应多个地点，请使用固定编号：' + target.matches.map(e => `${e.ref} ${e.waypoint.name}`).join('；')
                if (cmd.json) jsonReply({ ok: false, code: 'ambiguous_waypoint', summary, matches: target.matches })
                else reply(`[传送阵] ${summary}`)
              } else fail('waypoint_' + target.status, '没有找到这个传送点。/mycli waypoint 查看当前列表。')
              return
            }
            const result = await tpWaypoint(subject, target.entry.waypoint)
            if (cmd.json) jsonReply({ ...result, ref: target.entry.ref })
            else reply(`[传送阵] ${result.summary}`)
            return
          }
          const sub = cmd.args[0] ?? ''
          if (['记', 'add', '记录'].includes(sub)) {
            let name = cmd.args.slice(1).join(' ').trim()
            if (!name) {
              const names = new Set(waypoints.allFor(owner).map(w => w.name))
              let n = 1; while (names.has(`路标${n}`)) n++
              name = `路标${n}`
            }
            const wp = waypoints.add(owner, name, location.x!, location.y!, location.z!, location.dimension!)
            if (!wp) { fail('waypoint_limit', '个人传送点已满（10个），请先删除自己的旧点。'); return }
            const entry = waypoints.listWithRefs(owner).find(e => e.scope === 'personal' && e.waypoint.id === wp.id)!
            worlddb.chronicleRecord('cast', owner, { skill: 'waypoint-add', ref: entry.ref, name: wp.name, dimension: wp.dim })
            const result = { ok: true, code: 'waypoint_added', summary: `已记录「${wp.name}」· ${wp.dim} · ${entry.ref}。`, entry }
            if (cmd.json) jsonReply(result); else reply(`[传送阵] ${result.summary}`)
            return
          }
          if (['删', 'del', 'remove'].includes(sub)) {
            if (cmd.args.length !== 2) { fail('invalid_params', '用法：waypoint remove <个人序号|personal:id>。'); return }
            const query = cmd.args[1]
            const removed = query.startsWith('personal:') ? waypoints.removeRef(owner, query) :
              /^[1-9]\d*$/.test(query) ? waypoints.remove(owner, Number(query)) : null
            if (!removed) { fail('waypoint_not_found', '没有找到可删除的个人传送点；公共点不能在这里删除。'); return }
            const result = { ok: true, code: 'waypoint_removed', summary: `已删除「${removed.name}」。`, waypoint: removed }
            if (cmd.json) jsonReply(result); else reply(`[传送阵] ${result.summary}`)
            return
          }
          if (sub && !['list', '列表'].includes(sub) || cmd.args.length > 1) { fail('invalid_params', 'waypoint 支持 list、add <名字>、remove <个人编号>。'); return }
          showList()
        } catch (error) { fail('waypoint_storage_error', error instanceof Error ? error.message : '传送点未保存，请检查存储状态。') }
        return
      }
      case 'innate': {
        const arg = cmd.args.join(' ').trim()
        if (arg.startsWith('我选') || arg.startsWith('select')) {
          const name = arg.replace(/^我选\s*/, '').replace(/^select\s*/, '').trim()
          if (!name) { reply(`[CLI] 用法：/cli innate 我选 <法术名>。`); return }
          const atom = magic.listAtoms().find((a) => a.name === name || a.id === name.toLowerCase())
          if (!atom) { reply(`[CLI] 没有叫「${name}」的天赋法术。/cli spells 看法术表。`); return }
          magic.setInnate(subject, atom.id)
          const { json } = shapeInnate(atom.name)
          worlddb.chronicleRecord('innate_select', subject, { name })
          if (cmd.json) jsonReply({ ok: true, innateSet: atom.name })
          else reply(`[女神] ${subject}，你已选定出生天赋「${atom.name}」。这是与生俱来的能力，豁免等级门槛。`)
          return
        }
        const innateName = magic.getInnate(subject)
        const { panel, json } = shapeInnate(innateName)
        if (cmd.json) jsonReply({ ok: true, ...json })
        else replyLines(panel.split('\n'))
        return
      }
      case 'appraise': {
        await doAppraiseCli(cmd.args.join(' '))
        return
      }
      case 'guardian-cast': {
        // 认主代执行（2026-08-23）：守护天使替主人施放主人已学技能。仅 sys_<owner> 可用；
        // 普通玩家/主人自己施法走 cast（自施）或祈愿（神裁），不走此命令。
        if (!isGuardian) { reply(`[CLI] 此命令仅守护天使可用（以 sys_ 登录名代主人施法）。你自己施法用 cast <咒语>。`); return }
        const arg = (cmd.args[0] ?? '').trim()
        if (!arg) { reply(`[CLI] 用法：cli guardian-cast <法术id或名称>。用 cli spells 查主人已学法术。`); return }
        const atomId = magic.getAtomById(arg)?.id ?? magic.listAtoms().find((a) => a.name === arg)?.id
        if (!atomId) { reply(`[CLI] 没有「${arg}」这道法术。/cli spells 看法术表。`); return }
        const r = await magic.castAsOwner(subject, atomId)
        if (cmd.json) jsonReply({ ok: true, summary: r })
        else reply(`[信使] ${r}`)
        return
      }
      case 'cultivate': {
        // 修行灌顶（2026-08-28 造物主拍板：puffish 管理动词登记世界侧，AI/真人 cli 同效）。
        // 每次给自己灌 5 点经验，60s 冷却防灌水；命令语法已经 RCON 实测（puffish_skills experience add）。
        const cat = (cmd.args[0] ?? 'combat').trim().toLowerCase()
        if (!/^[a-z_]{2,24}$/.test(cat)) { reply(`[CLI] 用法：cli cultivate <类别>（如 combat，缺省 combat）。类别名只认小写字母。`); return }
        const cdMap = deps.getCultivationCooldowns()
        const now = deps.now()
        const last = cdMap.get(subject) ?? 0
        if (now - last < 60_000) { reply(`[修行] 真气未复，${Math.ceil((60_000 - (now - last)) / 1000)} 秒后再行灌顶。`); return }
        cdMap.set(subject, now)
        const login = resolveLogin(subject)
        const out = await rcon.send(`puffish_skills experience add ${login} ${cat} 5`).catch((e: unknown) => `施法失败：${String(e).slice(0, 120)}`)
        worlddb.chronicleRecord('cultivate', subject, { category: cat })
        deps.bubble?.show(subject, `「灌顶！」·${cat} +5`)
        if (cmd.json) jsonReply({ ok: true, category: cat, raw: String(out).slice(0, 200) })
        else reply(`[修行] 你盘膝运功，「${cat}」之途精进一分（经验 +5）。一息之后可再灌顶。`)
        return
      }
      case 'growth': {
        // 修行进度（2026-08-28）：查 puffish 经验/点数，语法已经 RCON 实测（experience get / points get）。
        const cat = (cmd.args[0] ?? 'combat').trim().toLowerCase()
        if (!/^[a-z_]{2,24}$/.test(cat)) { reply(`[CLI] 用法：cli growth <类别>（如 combat，缺省 combat）。`); return }
        const login = resolveLogin(subject)
        const exp = await rcon.send(`puffish_skills experience get ${login} ${cat}`).catch(() => '')
        const pts = await rcon.send(`puffish_skills points get ${login} ${cat}`).catch(() => '')
        const fmt = (s: string) => s.split('\n')[0].trim().slice(0, 120)
        if (cmd.json) jsonReply({ ok: true, category: cat, experience: fmt(exp), points: fmt(pts) })
        else replyLines([`【修行进度 · ${cat}】`, `  ${fmt(exp)}`, `  ${fmt(pts)}`, `  灌顶：cli cultivate ${cat}（60 秒一次，经验 +5）`])
        return
      }
      default:
        reply(`[CLI] 未知命令「${cmd.verb}」。/cli commands 看全部。`)
    }
  }

  async function executeRequest(request: PlayerCommandRequest): Promise<Record<string, unknown>> {
    const cmd = parseCli(/^(?:\/?mycli|\/?cli|!cli)\b/i.test(request.command)
      ? request.command : `/mycli ${request.command}`)
    if (!cmd || cmd.error) return { ok: false, code: 'invalid_command', summary: cmd?.error ?? '命令格式无效。' }
    if (!['help', 'commands', 'status', 'skills', 'spells', 'cast', 'learn', 'cancel', 'skillbar', 'menu', 'goto', 'waypoint'].includes(cmd.verb)) {
      return { ok: false, code: 'unsupported_command', summary: '技能 CLI 支持 help/status/skills/spells/cast/learn/skillbar/menu/goto/waypoint；角色对话仍使用原聊天工具。' }
    }
    const nativeRoute = ['goto', 'waypoint', 'cancel', 'status', 'spells'].includes(cmd.verb) ||
      (cmd.verb === 'cast' && (NATIVE_SPELL_ID.test(cmd.args[0] ?? '') || request.actor.includes('-'))) ||
      (cmd.verb === 'menu' && ['irons', '铁魔法'].includes(cmd.args[0]))
    if (!['help', 'commands'].includes(cmd.verb) && !nativeRoute) {
      const pos = parseNbtPosition(await rcon.send(`data get entity ${request.actor} Pos`))
      if (!pos) return { ok: false, code: 'offline', summary: '角色不在线；请先连接既有身体。技能 CLI 不会自动召唤角色。' }
    }
    let result: Record<string, unknown> = { ok: false, code: 'no_receipt', summary: '命令没有返回执行结果。' }
    await handleCli(request.actor, request.actor, { ...cmd, json: true }, false, value => { result = value })
    return result
  }

  return { handleCli, castUnified, executeRequest }
}
