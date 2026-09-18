"""第 1 层：让元层可见。

生成两份东西，落进共享笔记树：
  1. evolution-policy.{md,json} —— 这套自我改进体系的**规则本身**：什么算新证据、
     班次多久一次、验收怎么走、哪些理由码会拦住一次班次、角色**不许**碰什么。
     规则不是手写的：能读代码的地方就直接读代码常量（cron、阈值、guard 版本），
     免得文档与实现脱节 —— 今天整整一天的故障都出在"看得见的东西与真实的东西不一致"。
  2. evolution-board.{md,json} —— 一角色一行的**元层看板**：上次班次结果与时间、
     被拦的理由分布、证据指纹是否在动、技能级草稿数、真实知识产物数、以及红旗。

只读 + 只写这两处输出，不起模型、不碰任何角色的东西。
"""
import argparse
import json
import os
import time

from pathlib import Path

NOTES = Path(os.environ.get('WORLD_NOTES_DIR', '/state/work/world-notes'))
# QwenPaw 的 PawApp 目录：控制台按请求实时扫描它，所以建目录即生效（无需重启）。
PLUGINS = Path(os.environ.get('QWENPAW_PLUGINS_DIR', '/state/work/plugins'))
PAGE_ID = 'evolution-board'
WORKSPACES = Path('/state/work/workspaces')
LEARNING_SELF = Path(__file__).resolve()


def _const(module_path, name, default=None):
    """从一个源文件里读顶层常量（用 importlib 太脆，源码就在手边）。"""
    try:
        import re
        text = Path(module_path).read_text(encoding='utf-8')
        match = re.search(r'^%s\s*=\s*(.+)$' % re.escape(name), text, re.M)
        return match.group(1).strip() if match else default
    except OSError:
        return default


def code_facts():
    """能读代码就读代码：这些是政策的骨头，不能靠记忆。"""
    facts = {'guardVersion': _const('/ops/cron_guard.py', 'VERSION')}
    try:
        from agent_learning import managed_job
        facts['shiftCron'] = managed_job('qd-survivor', 'game')['schedule']['cron']
        facts['shiftTimeoutSeconds'] = managed_job('qd-survivor', 'game')['runtime']['timeout_seconds']
        facts['shiftMaxConcurrency'] = managed_job('qd-survivor', 'game')['runtime']['max_concurrency']
        facts['shiftTaskType'] = managed_job('qd-survivor', 'game')['task_type']
    except Exception as error:
        facts['shiftCron'] = None
        facts['shapeError'] = type(error).__name__
    # 常量名会变（小Q 2026-09-18 把它们拆成 FIRST/FROM/EVERY），所以这里读的是"现在真的存在的那几个"；
    # 读到 None 就是一次真实的脱节，要当故障看，别去改文档。
    facts['quotaCycles'] = '第一个班次=%s，第 %s 个班次起每 %s 班一次' % (
        _const('/survival/controller.py', 'EVOLUTION_CANDIDATE_FIRST_CYCLE'),
        _const('/survival/controller.py', 'EVOLUTION_CANDIDATE_FROM_CYCLE'),
        _const('/survival/controller.py', 'EVOLUTION_CANDIDATE_EVERY'))
    # sidecar 在不同容器里挂在不同路径（npc: /opt/sidecar，qwenpaw: /ops-sidecar），
    # 两个都试，免得又出现"读不到就写 None"的假空白。
    for candidate in ('/ops-sidecar/party_life.py', '/opt/sidecar/party_life.py'):
        value = _const(candidate, 'ABANDON_STALL_SECONDS')
        if value is not None:
            facts['abandonStallSeconds'] = value
            break
    else:
        facts['abandonStallSeconds'] = None
    facts['minPatternRepeats'] = _const('/survival/controller.py', 'MIN_PATTERN_REPEATS')
    facts['evidenceTrees'] = ['digest', 'notes', 'memory']
    facts['knowledgeCapPerTree'] = 200
    return facts


POLICY_JSON = lambda f: {
    'schema': 1,
    'generatedAt': time.time(),
    'generatedBy': 'world/ops/evolution_policy.py',
    'purpose': '这套自我改进体系的规则；改规则前先读它',
    'cadence': {
        'shiftCron': f['shiftCron'], 'timezone': 'Asia/Shanghai',
        'shiftTaskType': f['shiftTaskType'], 'timeoutSeconds': f['shiftTimeoutSeconds'],
        'maxConcurrency': f['shiftMaxConcurrency'],
        'note': '每小时 :20 敲一次门；起模型与否由证据闸决定',
    },
    'evidence': {
        'rule': '只有当证据指纹与上次记录不同，才真的开一次学习班',
        'material': ['learning/index.json 的 skills 与 feedback', 'learning/drafts',
                     'operations/reports/<role>', '角色工作区的 digest / notes / memory 三棵树（每树最多 %d 个文件）'
                     % f['knowledgeCapPerTree']],
        'trees': f['evidenceTrees'],
        'notEvidence': ['没有落盘的变化不算', '模型自己说完成了不算'],
    },
    'gateDecisions': {
        'no_new_learning_evidence': '指纹没动 —— 这是最常见的结果，不是故障',
        'operations_task_unresolved': '同一共享账本里还有未结的运营任务，先结它',
        'bounded_runtime_required': '超时>180s 或并发≠1 的班次不接受',
        'project_console_required': '班次必须走 console 通道',
        'unmanaged_operations_job': '非受管作业不跑模型',
        'unregistered_operations_role': '角色没登记',
        'team_native_host_inactive': '该角色的原生宿主未激活（登记表 runtime-hosts.json）',
        'use_existing_game_decision_controller': '历史理由码；2026-09-18 起，受管的游戏角色班次不再被它拦下',
    },
    'insideTheTurn': {
        'rule': '生存轮里到期的班次，本班正事即固化：产出草稿，或明确写下"本周期无可固化"',
        'quotaCycles': f['quotaCycles'],
        'safety': '身体正在受威胁时（血低/被围/险地）生存优先，本班顺延',
        'abandonStallSeconds': f['abandonStallSeconds'],
        'minPatternRepeats': f['minPatternRepeats'],
    },
    'acceptance': {
        'path': ['learning_draft', 'learning_validate', 'learning_activate',
                 'learning_feedback', 'learning_rollback'],
        'maxLearnedSkills': 8,
        'autoDisable': '同一条技能两次失败自动停用',
        'publishedTo': 'world-skills —— 其他角色可直接继承',
        'honestLimit': '格式与工具范围可被机器校验；真实验效果只能由执行后的证据说明',
    },
    'agentMayNotTouch': [
        '权限、冷却、守卫名单（tool_guard / denied_tools / guarded_tools）',
        '神谕裁决与祈愿处理',
        '网络出口与凭据',
        '"两次失败自动停用"这类阈值本身（否则可以自己放宽自己）',
        '角色身份、驱动与预算等受管配置',
    ],
    'machinery': {
        'ops': ['/ops/cron_guard.py', '/ops/agent_learning.py', '/ops/role_learning_profiles.py'],
        'survival': ['/survival/controller.py'],
        'sidecar': ['/opt/sidecar/party_life.py', '/opt/sidecar/party_messages.py'],
        'shared': '/state/work/world-notes/',
    },
    'guardVersion': f['guardVersion'],
    'editableKnobs': EDITABLE_KNOBS,
    'frozenKnobs': FROZEN_KNOBS,
}

POLICY_MD = """# 自我改进体系 · 规则（自动生成，勿手改）

本文件由 `world/ops/evolution_policy.py` 从**代码常量**读出后生成 —— 你若在这里看到与行为不符的东西，
那是一次真实的脱节，请把它当故障处理，而不是改文档。生成时间：{when}

## 一、节奏
- 学习班次：`{cron}`（Asia/Shanghai），任务类型 `{task}`，超时 {timeout}s，并发 {conc}。
- **每小时敲一次门；是否真的开模型，由证据闸决定** —— 铃，不是账单。

## 二、什么算"新证据"
只有当**证据指纹**与上次记录不同，才会真的开一次班。指纹的取材：

{material}

**不算证据的**：没有落盘的变化；模型自己说完成了。

## 三、闸门会用什么理由拦住一次班次
{decisions}

## 四、生存轮里的固化配额
- 到期班次（`cyclesSince ∈ {quota}`）：**本班正事就是固化** —— 产出草稿，或明确写下"本周期无可固化"。
- **安全优先**：身体受威胁时（血低/被围/险地）生存优先，本班顺延。
- 轮次无法观测超过 {stall}s 会被放弃并留下回执（并**要求操作员收尾**原生请求）。

## 五、验收怎么走
`learning_draft → learning_validate → learning_activate → learning_feedback → learning_rollback`
- 每角色最多 {maxskills} 条学习技能；**同一条两次失败自动停用**。
- 启用后的技能发布到 **world-skills**，其他角色**可直接继承**。
- 诚实的边界：格式与工具范围能被机器校验；**真实验效果只能由执行后的证据说明**。

## 六、角色**不许**碰的东西（改这些要经天神/造物主）
{forbidden}

## 六之二、角色可以提议改的（第 2 层）
{freeknobs}

**冻结区**（角色不得提议，须走造物主/天神）：
{frozen}

提议用 `learning_policy_draft` 提交；批准与否由天神裁决，**激活只能由操作员落地**。

## 七、机器在哪
{machinery}

---
**看板**：同目录 `evolution-board.md` —— 一角色一行，看谁在动、谁被拦、谁红了。
"""



# ---- 第 2 层：谁能改"怎么改" ------------------------------------------------
# 角色可以**提议**改这些；每一支都写明类型与边界，校验器照它判。
# 这是有意的窄门：只开放"怎么学"，不开放"能不能碰世界"。
EDITABLE_KNOBS = {
    'shift.cron': {'kind': 'cron', 'allowed': ['20 * * * *', '20 */2 * * *', '20 10 * * mon'],
                   'why': '班次节奏：多久敲一次门'},
    'evidence.trees': {'kind': 'list', 'allowed_values': ['digest', 'notes', 'memory', 'learning/drafts'],
                       'min': 1, 'max': 4, 'why': '什么算新证据：指纹要不要看这几棵树'},
    'quota.minPatternRepeats': {'kind': 'int', 'min': 2, 'max': 6,
                               'why': '台账候选要求同一模式至少重复几次'},
    'quota.candidateChars': {'kind': 'int', 'min': 300, 'max': 2000,
                             'why': '喂给角色看的候选块长度上限'},
    'shift.promptNote': {'kind': 'text', 'max_length': 600,
                         'why': '本班提示里加一句自己的话（会附在班次提示后）'},
}

FROZEN_KNOBS = {
    'permissions': '权限、冷却、守卫名单（tool_guard / denied_tools / guarded_tools）',
    'adjudication': '神谕裁决与祈愿处理',
    'credentials': '网络出口与凭据',
    'auto_disable_threshold': '“两次失败自动停用”这类阈值本身（否则可以自己放宽自己）',
    'identity': '角色身份、驱动与预算等受管配置',
    'self_activation': '自己批准自己的提议（激活只能由操作员/天神落地）',
}


def validate_proposal(role, changes, note):
    """角色提一条"改改进机制"的申请。只做形式与边界校验，不落地任何东西。

    返回 (ok, receipt)。无论通过与否都给出可读理由 —— 拒绝要能说清为什么，
    否则角色只会盲试。
    """
    problems = []
    if not isinstance(role, str) or not role:
        problems.append('role_missing')
    if not isinstance(note, str) or len(note.strip()) < 12:
        problems.append('note_too_short: 说清为什么该改（至少一句）')
    if not isinstance(changes, list) or not changes:
        problems.append('changes_missing')
    accepted = []
    for item in (changes or []):
        if not isinstance(item, dict):
            problems.append('change_not_object')
            continue
        knob = item.get('knob')
        value = item.get('value')
        if not isinstance(knob, str):
            problems.append('knob_missing')
            continue
        if knob in FROZEN_KNOBS:
            problems.append('%s: 这一项属于冻结区（%s）—— 角色不能提议，须走造物主/天神' % (knob, FROZEN_KNOBS[knob]))
            continue
        spec = EDITABLE_KNOBS.get(knob)
        if spec is None:
            problems.append('%s: 不在可提议清单里' % knob)
            continue
        kind = spec['kind']
        if kind == 'cron':
            if value not in spec['allowed']:
                problems.append('%s: 只接受 %s' % (knob, spec['allowed']))
                continue
        elif kind == 'int':
            if type(value) is not int or not spec['min'] <= value <= spec['max']:
                problems.append('%s: 需要 %d..%d 的整数' % (knob, spec['min'], spec['max']))
                continue
        elif kind == 'text':
            if not isinstance(value, str) or len(value) > spec['max_length']:
                problems.append('%s: 文本且不超过 %d 字' % (knob, spec['max_length']))
                continue
        elif kind == 'list':
            if (not isinstance(value, list) or not value
                    or any(v not in spec['allowed_values'] for v in value)
                    or not spec['min'] <= len(value) <= spec['max']):
                problems.append('%s: 只能是 %s 里选 %d..%d 项' % (
                    knob, spec['allowed_values'], spec['min'], spec['max']))
                continue
        accepted.append({'knob': knob, 'value': value, 'why': spec['why']})
    return (not problems), {'schema': 1, 'role': role, 'note': note.strip()[:600],
                            'accepted': accepted, 'problems': problems,
                            'status': 'pending_operator_review' if not problems else 'rejected',
                            'activation': '只能由操作员/天神落地；角色不得自行激活'}

def board_rows():
    rows = []
    now = time.time()
    for folder in sorted(p for p in WORKSPACES.iterdir() if p.is_dir()):
        role = folder.name
        learning = folder / 'learning'
        if not (folder / 'skills' / 'qd-skill-evolution').exists():
            continue
        row = {'role': role}
        marker = learning / 'last-cron.json'
        if marker.exists():
            try:
                record = json.loads(marker.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                record = {}
            row['lastShift'] = {'status': record.get('status'), 'code': record.get('code'),
                                'ageMinutes': round((now - (record.get('reservedAt')
                                                           or record.get('checkedAt') or 0)) / 60)}
        else:
            row['lastShift'] = None
        drafts = len([x for x in (learning / 'drafts').rglob('*') if x.is_file()]) \
            if (learning / 'drafts').is_dir() else 0
        row['drafts'] = drafts
        knowledge = 0
        newest = 0
        for sub in ('digest', 'notes', 'memory'):
            tree = folder / sub
            if not tree.is_dir():
                continue
            for item in tree.rglob('*'):
                if item.is_file():
                    knowledge += 1
                    newest = max(newest, item.stat().st_mtime)
        row['knowledge'] = knowledge
        row['knowledgeFreshMinutes'] = round((now - newest) / 60) if newest else None
        row['flags'] = []
        if newest and (now - newest) > 12 * 3600:
            row['flags'].append('knowledge_stale')
        if knowledge == 0:
            row['flags'].append('no_knowledge')
        if drafts == 0 and knowledge > 0:
            row['flags'].append('no_skill_draft_yet')
        if row['lastShift'] and row['lastShift']['status'] == 'skipped' \
                and row['lastShift']['code'] not in ('no_new_learning_evidence',):
            row['flags'].append('gate:' + str(row['lastShift']['code']))
        rows.append(row)
    return rows


PAGE_HTML = """<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>自我改进 · 元层看板</title>
<style>
 :root{--bg:#0f1115;--card:#171a21;--line:#252a34;--txt:#e6e8ee;--dim:#8b93a7;
        --ok:#3fbf7f;--warn:#e2b93b;--bad:#e5605e;--acc:#6aa9ff}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--txt);
      font:14px/1.5 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
 header{padding:18px 22px;border-bottom:1px solid var(--line);display:flex;
        flex-wrap:wrap;gap:16px;align-items:baseline}
 h1{font-size:17px;margin:0;font-weight:600}
 .meta{color:var(--dim);font-size:12px}
 .kpis{display:flex;gap:10px;flex-wrap:wrap;margin:16px 22px 0}
 .kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;
       padding:10px 14px;min-width:120px}
 .kpi b{display:block;font-size:20px;margin-top:2px}
 main{padding:16px 22px 40px}
 table{width:100%;border-collapse:collapse;background:var(--card);
        border:1px solid var(--line);border-radius:12px;overflow:hidden}
 th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line);font-size:13px}
 th{color:var(--dim);font-weight:500;background:#12151b}
 tr:last-child td{border-bottom:0}
 td.num{text-align:right;font-variant-numeric:tabular-nums}
 .flag{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;
        border:1px solid var(--line);margin-right:4px;color:var(--dim)}
 .flag.bad{color:#ffd9d8;border-color:#5c2a29;background:#2a1716}
 .flag.warn{color:#f6e2b0;border-color:#5a4a1e;background:#26200f}
 .flag.good{color:#cfead9;border-color:#245239;background:#12241a}
 code{color:var(--acc)}
 .foot{margin-top:14px;color:var(--dim);font-size:12px}
 details{margin-top:16px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px}
 summary{cursor:pointer;color:var(--acc);font-size:13px}
 pre{white-space:pre-wrap;color:var(--dim);font-size:12px}
</style>
</head>
<body>
<header>
  <h1>自我改进 · 元层看板</h1>
  <span class="meta" id="stamp">加载中…</span>
  <span class="meta">每 60 秒自动刷新</span>
</header>
<div class="kpis" id="kpis"></div>
<main>
  <table>
    <thead><tr>
      <th>角色</th><th>上次班次</th><th>多久前</th>
      <th class="num">技能草稿</th><th class="num">知识产物</th>
      <th>知识新鲜度</th><th>红旗</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <details><summary>规则（这份看板背后的政策）</summary><pre id="policy"></pre></details>
  <div class="foot">数据来自 <code>world/ops/evolution_policy.py</code> 生成的两份文件，与共享笔记树同源。</div>
</main>
<script>
const FLAG = {'no_knowledge':'bad','knowledge_stale':'warn','no_skill_draft_yet':'warn'};
function cls(f){
  if(f.startsWith('gate:')||f==='no_knowledge') return 'bad';
  if(f==='knowledge_stale'||f==='no_skill_draft_yet') return 'warn';
  return '';
}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
async function tick(){
  const r = await fetch('board.json?ts=' + Date.now());
  const d = await r.json();
  const roles = d.roles || [];
  const flagged = roles.filter(x=>(x.flags||[]).length);
  const drafts = roles.reduce((a,x)=>a+(x.drafts||0),0);
  const know = roles.reduce((a,x)=>a+(x.knowledge||0),0);
  document.getElementById('stamp').textContent =
    '生成于 ' + new Date((d.generatedAt||0)*1000).toLocaleString() + ' ｜ 角色 ' + roles.length + ' ｜ 红旗 ' + flagged.length;
  document.getElementById('kpis').innerHTML =
    [['角色', roles.length, ''],['红旗', flagged.length, flagged.length?'bad':'good'],
     ['技能草稿', drafts, drafts?'good':'warn'],['知识产物', know, '']]
    .map(([k,v,c])=>`<div class="kpi">${k}<b class="${c}">${v}</b></div>`).join('');
  document.getElementById('rows').innerHTML = roles.map(x=>{
    const s = x.lastShift || {};
    const flags = (x.flags||[]).map(f=>`<span class="flag ${cls(f)}">${esc(f)}</span>`).join('') || '<span class="flag good">—</span>';
    return `<tr><td><b>${esc(x.role)}</b></td><td>${esc(s.code||'—')}</td>`
      + `<td class="num">${s.ageMinutes!=null?Math.round(s.ageMinutes)+' 分钟':'—'}</td>`
      + `<td class="num">${x.drafts??0}</td><td class="num">${x.knowledge??0}</td>`
      + `<td>${x.knowledgeFreshMinutes!=null?Math.round(x.knowledgeFreshMinutes)+' 分钟前':'—'}</td>`
      + `<td>${flags}</td></tr>`;
  }).join('');
  try{
    const p = await (await fetch('policy.json?ts='+Date.now())).json();
    document.getElementById('policy').textContent = JSON.stringify({
      cadence:p.cadence, evidence:p.evidence, insideTheTurn:p.insideTheTurn,
      acceptance:p.acceptance, agentMayNotTouch:p.agentMayNotTouch
    }, null, 1);
  }catch(e){}
}
tick(); setInterval(tick, 60000);
</script>
</body>
</html>
"""


def write_pawapp(policy, rows, numbers=None):
    """把它做成 QwenPaw 控制台里的一个真页面（PawApp），而不是一份 md 文件。

    控制台按请求实时扫描 plugins 目录，所以建目录即生效、不需要重启；
    静态资源由控制台自己的 /api/pawapps/<id>/static/... 伺服，页面就与它同源取数。
    """
    folder = PLUGINS / PAGE_ID
    folder.mkdir(parents=True, exist_ok=True)
    manifest = {
        'id': PAGE_ID,
        'name': '自我改进看板',
        'version': '1.0.0',
        'description': '这套自我改进体系的元层看板：一角色一行，看谁在动、谁被拦、谁红了。',
        'type': 'app',
        'meta': {'pawapp': {'category': 'monitor', 'icon': '📈',
                            'entry_page': 'index.html', 'launch_scope': 'global'},
                 'settings': []},
    }
    (folder / 'plugin.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')
    (folder / 'index.html').write_text(PAGE_HTML, encoding='utf-8')
    (folder / 'board.json').write_text(
        json.dumps({'schema': 1, 'generatedAt': time.time(), 'roles': rows,
                    'metrics': numbers or {}}, ensure_ascii=False), encoding='utf-8')
    (folder / 'policy.json').write_text(json.dumps(policy, ensure_ascii=False), encoding='utf-8')
    return {'appId': PAGE_ID, 'dir': str(folder),
            'entry': '/api/pawapps/%s/static/index.html' % PAGE_ID}


def proposals():
    """待审的政策提议 —— 读**世界的工单系统**，不是自己的私有目录。

    曾经我在这里另起过一套 policy-proposals/ 载体；那是重复造轮子：工单系统早有
    case id、dedupe、owner、status 与版本。现在这里只做一件事：把 category=improvement
    的未结工单读出来，让"提了没人看"不可能发生。
    """
    try:
        from world_team import TeamStore
        result = TeamStore('game:mc-god').cases(owner='all', include_closed=False, limit=30)
    except Exception as error:
        return [{'error': type(error).__name__}]
    return [{'id': row.get('id'), 'role': row.get('author'), 'owner': row.get('owner'),
             'status': row.get('status'), 'version': row.get('version'),
             'title': (row.get('title') or '')[:70]}
            for row in result.get('cases', []) if row.get('category') == 'improvement']



def _learning_totals():
    """技能级产出：drafts 与已启用技能（激活在 learning/index.json 的 skills）。"""
    drafts = 0
    activated = 0
    for folder in WORKSPACES.iterdir():
        if not folder.is_dir():
            continue
        tree = folder / 'learning' / 'drafts'
        if tree.is_dir():
            drafts += len([x for x in tree.rglob('*') if x.is_file()])
        index = folder / 'learning' / 'index.json'
        if index.exists():
            try:
                activated += len((json.loads(index.read_text(encoding='utf-8')).get('skills') or {}))
            except (OSError, ValueError):
                pass
    shared = Path('/state/work/world-skills')
    published = len([x for x in shared.rglob('*') if x.is_file()]) if shared.is_dir() else 0
    return drafts, activated, published


def _case_totals():
    """工单侧：未结分布 + 已结单的处理时长（events 里有时刻）。"""
    try:
        from world_team import TeamStore
        store = TeamStore('game:mc-god')
        rows = store.cases(owner='all', include_closed=True, limit=30).get('cases', [])
    except Exception as error:
        return {'error': type(error).__name__}
    counts = {}
    for row in rows:
        counts[row.get('status')] = counts.get(row.get('status'), 0) + 1
    durations = []
    for row in rows:
        if row.get('status') != 'resolved':
            continue
        try:
            events = store.case(row['id'], event_limit=20).get('events') or []
        except Exception:
            continue
        stamps = [e.get('at') for e in events if isinstance(e.get('at'), (int, float))]
        if len(stamps) >= 2:
            durations.append((max(stamps) - min(stamps)) / 60.0)
    durations.sort()
    return {'counts': counts, 'resolvedSampled': len(durations),
            'resolutionMedianMinutes': round(durations[len(durations) // 2], 1) if durations else None}


def _flag_history(rows):
    """红旗史：某个红旗**第一次出现**到现在多久 —— "被发现了多久还没处理"的数字。

    以前没有这个数，所以"故障处理要多快"只能靠感觉 ✗；看板每次都追加一行，
    于是每个红旗的年龄都是算出来的，不是估的。
    """
    path = NOTES / 'flag-history.jsonl'
    now = time.time()
    current = {}
    for row in rows:
        for flag in row.get('flags') or []:
            current['%s|%s' % (row['role'], flag)] = True
    with path.open('a', encoding='utf-8') as stream:
        stream.write(json.dumps({'at': now, 'flags': sorted(current)}, ensure_ascii=False) + '\n')
    first = {}
    try:
        for line in path.read_text(encoding='utf-8').splitlines():
            if not line.strip():
                continue
            record = json.loads(line)
            for key in record.get('flags') or []:
                first.setdefault(key, record.get('at'))
    except (OSError, ValueError):
        pass
    ages = []
    for key in sorted(current):
        seen = first.get(key, now)
        ages.append({'flag': key, 'minutes': round((now - seen) / 60.0, 1)})
    ages.sort(key=lambda item: -item['minutes'])
    return ages


def metrics(rows):
    """第 4 层：把"改进是否让下一轮更好"变成数。

    只统计数据真的支持的东西；支持不了的就写明没有记录 —— 编一个好看的数比没有数更糟，
    因为它会让下一轮的自改变成优化一个幻觉。
    """
    drafts, activated, published = _learning_totals()
    cases = _case_totals()
    report = {
        'schema': 1, 'generatedAt': time.time(),
        'skillLevel': {'drafts': drafts, 'activated': activated, 'sharedPublished': published,
                       'inherited': None,
                       'inheritedNote': '没有记录：learning/index.json 未记技能来源角色，'
                                        '所以"跨角色继承"目前无法计算 —— 要它成为数字，先让索引记来源。'},
        'cases': cases,
        'flagAges': _flag_history(rows),
        'honestLimits': [
            '技能级产出全为 0 时，任何"改进效果"都只能是相对基线说的，不能凭空说变好',
            '继承率需要索引记录来源角色；回退率需要 feedback 里有失败记录',
        ],
    }
    baseline = NOTES / 'metrics-baseline.json'
    if not baseline.exists():
        baseline.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
        report['baselineRecorded'] = True
    (NOTES / 'metrics.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
    return report


def write_outputs():
    facts = code_facts()
    NOTES.mkdir(parents=True, exist_ok=True)
    policy = POLICY_JSON(facts)
    (NOTES / 'evolution-policy.json').write_text(
        json.dumps(policy, ensure_ascii=False, indent=1), encoding='utf-8')
    material = '\n'.join('- ' + item for item in policy['evidence']['material'])
    decisions = '\n'.join('- `%s` —— %s' % (key, value)
                          for key, value in policy['gateDecisions'].items())
    forbidden = '\n'.join('- ' + item for item in policy['agentMayNotTouch'])
    machinery = '\n'.join('- `%s`：%s' % (key, '、'.join(value) if isinstance(value, list) else value)
                          for key, value in policy['machinery'].items())
    (NOTES / 'evolution-policy.md').write_text(POLICY_MD.format(
        when=time.strftime('%Y-%m-%d %H:%M:%S'), cron=facts['shiftCron'], task=facts['shiftTaskType'],
        timeout=facts['shiftTimeoutSeconds'], conc=facts['shiftMaxConcurrency'],
        material=material, decisions=decisions, quota=facts['quotaCycles'],
        stall=facts['abandonStallSeconds'], maxskills=policy['acceptance']['maxLearnedSkills'],
        forbidden=forbidden, machinery=machinery,
        freeknobs='\n'.join('- `%s` —— %s（%s）' % (k, v['why'], v['kind'])
                          for k, v in EDITABLE_KNOBS.items()),
        frozen='\n'.join('- %s：%s' % (k, v) for k, v in FROZEN_KNOBS.items())), encoding='utf-8')

    rows = board_rows()
    # 指标要在看板用到它之前算好；也只能算一次 —— 算两次会把红旗史重复追加一行。
    numbers = metrics(rows)
    flagged = [row for row in rows if row['flags']]
    header = ('# 自我改进 · 元层看板（自动生成）\n\n'
              '生成时间：%s ｜ 角色数：%d ｜ 红旗：%d\n\n'
              '| 角色 | 上次班次 | 多久前 | 技能草稿 | 知识产物 | 知识新鲜度 | 红旗 |\n'
              '|---|---|---|---|---|---|---|\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), len(rows), len(flagged)))
    lines = []
    for row in rows:
        shift = row['lastShift'] or {}
        lines.append('| %s | %s | %s | %d | %d | %s | %s |' % (
            row['role'], shift.get('code') or '—',
            ('%.0f 分钟' % shift['ageMinutes']) if shift else '—',
            row['drafts'], row['knowledge'],
            ('%.0f 分钟前' % row['knowledgeFreshMinutes']) if row.get('knowledgeFreshMinutes') is not None else '—',
            '、'.join(row['flags']) or '—'))
    body = header + '\n'.join(lines) + '\n'
    pending = proposals()
    if pending:
        body += ('\n## 待审的改进提议（工单系统 · category=improvement）\n\n'
                 '| 工单 | 提交者 | 状态 | 归属 | 标题 |\n|---|---|---|---|---|\n')
        body += '\n'.join('| %s | %s | %s | %s | %s |' % (
            row.get('id', '—'), row.get('role', '—'), row.get('status', '—'),
            row.get('owner') or '未指派', row.get('title', '')) for row in pending) + '\n'
    skill = numbers['skillLevel']
    body += ('\n## 指标（第 4 层：改进是否让下一轮更好）\n\n'
             '- 技能级产出：草稿 **%s** ／ 已启用 **%s** ／ 已发布到世界技能库 **%s**'
             '（继承率：%s）\n'
             '- 工单：%s；已结单样本 %s 条，中位处理时长 %s 分钟\n'
             '- 红旗年龄（被发现了多久还没处理，最老三条）：%s\n'
             % (skill['drafts'], skill['activated'], skill['sharedPublished'],
                skill['inheritedNote'] if skill['inherited'] is None else skill['inherited'],
                json.dumps(numbers['cases'].get('counts', {}), ensure_ascii=False),
                numbers['cases'].get('resolvedSampled'),
                numbers['cases'].get('resolutionMedianMinutes'),
                '、'.join('%s=%.0f 分钟' % (item['flag'], item['minutes'])
                          for item in numbers['flagAges'][:3]) or '无'))
    (NOTES / 'evolution-board.md').write_text(body, encoding='utf-8')
    (NOTES / 'evolution-board.json').write_text(
        json.dumps({'schema': 1, 'generatedAt': time.time(), 'roles': rows}, ensure_ascii=False, indent=1),
        encoding='utf-8')
    # 控制台只按工作区浏览文件（越界预览默认关闭），所以除了共享笔记树，还要镜像一份
    # 进一个**已启用**的 agent 工作区，这样在 QwenPaw 的 Web 面板里点开就能看到。
    mirrored = []
    # mc-god = 灯语女神·世界管理，qd-steward = 司灯（项目协调人），qd-survivor = 桐人：
    # 三个都已启用，面板里点开工作区就能看到。角色自己也可以读共享那份。
    for role in ('mc-god', 'qd-steward', 'qd-survivor'):
        folder = WORKSPACES / role
        if not folder.is_dir():
            continue
        try:
            for name in ('evolution-board.md', 'evolution-policy.md'):
                (folder / name).write_text((NOTES / name).read_text(encoding='utf-8'), encoding='utf-8')
            mirrored.append(role)
        except OSError:
            continue
    page = write_pawapp(policy, rows, numbers)
    return {'ok': True, 'roles': len(rows), 'flagged': len(flagged),
            'notes': str(NOTES), 'cron': facts['shiftCron'], 'mirroredInto': mirrored,
            'page': page}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='只报告红旗，不写文件')
    args = parser.parse_args()
    if args.check:
        rows = board_rows()
        flagged = [row for row in rows if row['flags']]
        print(json.dumps({'ok': not flagged, 'roles': len(rows), 'flagged': flagged}, ensure_ascii=False))
        return
    print(json.dumps(write_outputs(), ensure_ascii=False))


if __name__ == '__main__':
    main()
