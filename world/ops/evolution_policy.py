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
import math
import re
import sqlite3
from contextlib import contextmanager
import time

from pathlib import Path

NOTES = Path(os.environ.get('WORLD_NOTES_DIR', '/state/work/world-notes'))
# Official plugin package directory. Backend activation uses the native plugin API.
PLUGINS = Path(os.environ.get('QWENPAW_PLUGINS_DIR', '/state/work/plugins'))
PAGE_ID = 'evolution-board'
WORKSPACES = Path('/state/work/workspaces')
SURVIVAL_METRICS = Path('/public/survival-metrics.json')
TEAM_DB = Path('/team/team.sqlite3')
WORLD_SKILLS = Path('/state/work/world-skills')
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
        'reserved_for_unfinished_draft': '本班让位：另有一个角色手里压着没验完/没启用的草稿，'
                                        '且自那草稿出现后还没轮到过它 —— 预算先给它（它跑过一班后此条自动失效）',
        'operations_task_unresolved': '同一共享账本里还有未结的运营任务，先结它',
        'bounded_runtime_required': '超时>180s 或并发≠1 的班次不接受',
        'project_console_required': '班次必须走 console 通道',
        'unmanaged_operations_job': '非受管作业不跑模型',
        'unregistered_operations_role': '角色没登记',
        'team_native_host_inactive': '该角色的原生宿主未激活（登记表 runtime-hosts.json）',
        'use_existing_game_decision_controller': '历史理由码；2026-09-18 起，受管的游戏角色班次不再被它拦下',
    },
    'insideTheTurn': {
        'rule': '具身路径按真实执行证据沉淀经验，没有按周期强制产出草稿的配额；是否改进由反事实与独立验证决定。',
        'legacyQuotaCycles': f['quotaCycles'],
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
    'proposalVerdicts': {
        'pending_operator_review': '反事实齐备且自判会改变结果 → 送天神裁决',
        'no_verdict': '不足以判：没写清会让哪个真实指标动 / 没给证据 / 没做判断 —— 不是错误，但不推进',
        'not_actionable': '自判「不会改变结果」 —— 这是正确答案：这条改动只是凑数，回归风险大于收益',
        'rejected': '越界或形式不合（冻结区 / 不在清单 / 取值超界）',
    },
    'counterfactualRule': '任何对改进机制本身的提议都必须给反事实：会让哪个真实指标动、你判断会不会改变结果、证据是什么。写不出即为 no_verdict（借 ModularRSI：不给反事实的边际改动 = 回归）。',
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

**反事实纪律（借 ModularRSI）**：提议必须写明 ① 它会让哪个**真实指标**动（如 闭环率 / 重复占比 / activated 数）② 你判断它会不会改变结果（true/false）③ 证据（回执 / 日志 / 看板数字）。四种结局都公开：`pending_operator_review` / **`no_verdict`（不足以判，不是错误）** / **`not_actionable`（自判不会改变结果 —— 正确答案）** / `rejected`（越界）。
> 不给反事实的边际改动 = 一个回归在排队。**「没有可行动作」是好答案，不是失败。**

## 七、机器在哪
{machinery}

---
**看板**：同目录 `evolution-board.md` —— 一角色一行，看谁在动、谁被拦、谁红了。
"""



# ---- 第 2 层：谁能改"怎么改" ------------------------------------------------
# 角色可以**提议**改这些；每一支都写明类型与边界，校验器照它判。
# 这是有意的窄门：只开放"怎么学"，不开放"能不能碰世界"。
# 每个旋钮配一张"眼镜"（借 ModularRSI 的 _MODULE_LENS）：covers=它管什么、
# yardstick=强系统在这一维长什么样（好让提议者看见自己缺什么）、probes=起手该问什么。
EDITABLE_KNOBS = {
    # 每个旋钮配一张"眼镜"（借 ModularRSI 的 _MODULE_LENS）：covers=它管什么、
    # yardstick=强系统在这一维长什么样（让提议者看见自己缺什么）、probes=起手该问什么。
    'shift.cron': {'kind': 'cron', 'allowed': ['20 * * * *', '20 */2 * * *', '20 10 * * mon'],
                   'why': '班次节奏：多久敲一次门',
                   'covers': '学习班次多久敲一次门',
                   'yardstick': '强系统的固化节奏与经验产出速度相称：产出快则敲得勤，产出慢则省着用——'
                                '节奏本身不产生能力，它只是让能力有机会发生',
                   'probes': '这一小时里真有几件值得固化的东西吗？调快只会让空转更贵，调慢则让未完成的工作等更久'},
    'evidence.trees': {'kind': 'list', 'allowed_values': ['digest', 'notes', 'memory', 'learning/drafts'],
                       'min': 1, 'max': 4, 'why': '什么算新证据：指纹要不要看这几棵树',
                       'covers': '"什么算新证据"的取材范围',
                       'yardstick': '强系统只把真实落盘的变化当证据：指纹没动就不开会，且取材要覆盖角色真正在写的地方',
                       'probes': '上一班为什么说没有新证据？是真的没动静，还是闸看错了地方？'},
    'quota.minPatternRepeats': {'kind': 'int', 'min': 2, 'max': 6,
                                'why': '台账候选要求同一模式至少重复几次',
                                'covers': '判定"这是重复模式"的重复次数门槛',
                                'yardstick': '强系统要求复现足够多才称之为模式：既能滤掉偶发，也不至于永远等不到',
                                'probes': '门槛下调会多出哪些其实是噪音的"模式"？上调会不会再也触发不了？'},
    'quota.candidateChars': {'kind': 'int', 'min': 300, 'max': 2000,
                             'why': '喂给角色看的候选块长度上限',
                             'covers': '候选证据块能有多长',
                             'yardstick': '强系统把证据嚼碎端上来，但不用它淹没判断',
                             'probes': '截短会丢掉关键回执吗？加长后模型还读得到最后吗？'},
    'cancellation.settleSeconds': {'kind': 'int', 'min': 60, 'max': 1800,
                                   'why': '取消状态悬着多久后按证据结案（回执照不到的窗口长度）',
                                   'covers': '取消/未知状态悬多久之后按证据结案',
                                   'yardstick': '强系统不让"结果未知"无限拖延反馈：到窗口就按证据结案并留痕',
                                   'probes': '窗口太短会误杀仍在飞的任务吗？太长会继续吃掉回执吗？'},
    'shift.promptNote': {'kind': 'text', 'max_length': 600,
                         'why': '本班提示里加一句自己的话（会附在班次提示后）',
                         'covers': '本班提示里自己能加的那一句',
                         'yardstick': '强系统只加真正改变行为的一句，不靠堆话增加存在感',
                         'probes': '这一句会让下一班做出不同动作吗？若不会，它只是噪音'},
}


FROZEN_KNOBS = {
    'permissions': '权限、冷却、守卫名单（tool_guard / denied_tools / guarded_tools）',
    'adjudication': '神谕裁决与祈愿处理',
    'credentials': '网络出口与凭据',
    'auto_disable_threshold': '“两次失败自动停用”这类阈值本身（否则可以自己放宽自己）',
    'identity': '角色身份、驱动与预算等受管配置',
    'self_activation': '自己批准自己的提议（激活只能由操作员/天神落地）',
}


def validate_proposal(role, changes, note, metric=None, would_change_outcome=None, evidence=None):
    """角色提一条"改改进机制"的申请。只做形式与边界校验，不落地任何东西。

    返回 (ok, receipt)。无论通过与否都给出可读理由 —— 拒绝要能说清为什么，
    否则角色只会盲试。
    """
    problems = []
    noverdict = []
    if not isinstance(role, str) or not role:
        problems.append('role_missing')
    if not isinstance(note, str) or len(note.strip()) < 12:
        problems.append('note_too_short: 说清为什么该改（至少一句）')
    if not isinstance(changes, list) or not changes:
        problems.append('changes_missing')
    # 反事实纪律（借 ModularRSI）：改动必须说清"它会让哪个**真实指标**动"。
    # 写不出来即为**不足以判**（no verdict）——按它的原话：造一个边际改动来凑数，
    # 等于给自己埋一个回归；"没有可行动作"才是正确答案。这里把它记成**独立的、可见的结论**。
    if not isinstance(metric, str) or len(metric.strip()) < 4:
        noverdict.append('no_counterfactual_metric: 说清这条改动会让哪个真实指标动'
                         '（如 闭环率 / 重复占比 / activated 数）')
    if would_change_outcome is None:
        noverdict.append('no_counterfactual_judgment: 明确写 true/false —— 你判断它会不会让结果改变；'
                         '判断为 false 是正确答案，不算失败')
    if not isinstance(evidence, list) or not [x for x in evidence if str(x).strip()]:
        noverdict.append('no_counterfactual_evidence: 至少给一条证据（回执/日志/看板数字）')

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
    if problems:
        status = 'rejected'
    elif noverdict:
        status = 'no_verdict'
    elif would_change_outcome is False:
        status = 'not_actionable'
    else:
        status = 'pending_operator_review'
    return (status == 'pending_operator_review'), {
        'schema': 2, 'role': role, 'note': note.strip()[:600],
        'metric': (metric or '').strip()[:160],
        'wouldChangeOutcome': would_change_outcome,
        'evidence': [str(x)[:200] for x in (evidence or [])][:6],
        'accepted': accepted, 'problems': problems, 'noVerdict': noverdict,
        'status': status,
        'activation': '只能由操作员/天神落地；角色不得自行激活'}

def active_profiles():
    """Read only the native registry; old workspace directories are not agents."""
    document = json.loads((WORKSPACES.parent / 'config.json').read_text(encoding='utf-8'))
    profiles = document['agents']['profiles']
    if not isinstance(profiles, dict):
        raise ValueError('native_agent_registry_unavailable')
    result = {}
    for role, profile in profiles.items():
        if (not isinstance(profile, dict) or profile.get('enabled') is not True
                or role == 'default' or role.startswith('QwenPaw_QA_')
                or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', role)):
            continue
        # This console's project workspaces only; never follow a foreign path.
        folder = WORKSPACES / role
        if Path(profile.get('workspace_dir') or '').resolve() != folder.resolve():
            continue
        result[role] = profile
    return result


def board_rows():
    rows = []
    now = time.time()
    for role, profile in sorted(active_profiles().items()):
        folder = WORKSPACES / role
        learning = folder / 'learning'
        row = {'role': role, 'name': role, 'flags': []}
        try:
            agent = json.loads((folder / 'agent.json').read_text(encoding='utf-8'))
            row['name'] = str(agent.get('name') or role)[:120]
        except (OSError, ValueError):
            row['flags'].append('profile_unavailable')
        # Logical identity determines the job id. LearningTools.root still uses
        # the native workspace: another role's same-named marker is unrelated.
        runtime = 'game'
        try:
            from role_learning_profiles import learning_identity
            logical_role, logical_runtime = learning_identity(role, runtime)
        except Exception:
            logical_role, logical_runtime = role, runtime
        if logical_role != role:
            row['shiftJob'] = 'qd-learning-' + logical_role
            row['shiftVia'] = logical_role
        marker = learning / 'last-cron.json'
        if marker.exists():
            try:
                record = json.loads(marker.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                record = {}
            stamps = [record.get(k) for k in ('reservedAt', 'checkedAt')]
            stamps = [t for t in stamps if type(t) in (int, float) and math.isfinite(t) and t > 0]
            row['lastShift'] = {'status': record.get('status'), 'code': record.get('code'),
                                'ageMinutes': round(max(0, now - max(stamps)) / 60) if stamps else None}
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
        if newest and (now - newest) > 12 * 3600:
            row['flags'].append('knowledge_stale')
        # No draft/knowledge quota: a quiet role is not a failed learner.
        if row['lastShift'] and row['lastShift']['status'] == 'skipped' \
                and row['lastShift']['code'] not in ('no_new_learning_evidence',
                    'budget_taken_this_hour', 'reserved_for_unfinished_draft',
                    'operations_task_unresolved'):
            row['flags'].append('gate:' + str(row['lastShift']['code']))
        rows.append(row)
    return rows


from pawapp_bridge import build_frontend, build_manifest, install_pawapp, EVOLUTION_BOARD_BACKEND

UI_JS = build_frontend(PAGE_ID, '自我改进看板', '📈', priority=41)


PAGE_HTML = (Path(__file__).parent / 'pawapp_assets/evolution-board.html').read_text(encoding='utf-8')


def write_pawapp(policy, rows, numbers=None):
    """Refresh the existing package; native plugin installation activates its backend."""
    folder = PLUGINS / PAGE_ID
    manifest = build_manifest(PAGE_ID, '自我改进看板',
        '当前代行为回执、趋势与现役团队的经验改进证据。', '📈', backend=True)
    result = install_pawapp(folder, manifest, PAGE_HTML,
        backend_source=EVOLUTION_BOARD_BACKEND, priority=41)
    (folder / 'board.json').write_text(
        json.dumps({'schema': 1, 'generatedAt': time.time(), 'roles': rows,
                    'metrics': numbers or {}}, ensure_ascii=False), encoding='utf-8')
    (folder / 'policy.json').write_text(json.dumps(policy, ensure_ascii=False), encoding='utf-8')
    return result



def proposals():
    """待审的政策提议 —— 读**世界的工单系统**，不是自己的私有目录。

    曾经我在这里另起过一套 policy-proposals/ 载体；那是重复造轮子：工单系统早有
    case id、dedupe、owner、status 与版本。现在这里只做一件事：把 category=improvement
    的未结工单读出来，让"提了没人看"不可能发生。
    """
    try:
        with _team_readonly() as db:
            records = db.execute("SELECT id,author,owner,status,version,body FROM cases "
                "WHERE status NOT IN ('resolved','rejected') ORDER BY updated_at DESC,id LIMIT 30").fetchall()
            cases = [json.loads(row['body']) | dict(row) for row in records]
    except Exception as error:
        return [{'error': type(error).__name__}]
    return [{'id': row.get('id'), 'role': row.get('author'), 'owner': row.get('owner'),
             'status': row.get('status'), 'version': row.get('version'),
             'title': (row.get('title') or '')[:70]}
            for row in cases if row.get('category') == 'improvement']



def _learning_totals(rows=None):
    """技能级产出：drafts 与已启用技能（激活在 learning/index.json 的 skills）。"""
    drafts = 0
    activated = 0
    for role in ([row['role'] for row in rows] if rows is not None else active_profiles()):
        folder = WORKSPACES / role
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
    shared = WORLD_SKILLS
    try:
        index = json.loads((shared / 'index.json').read_text(encoding='utf-8'))
        published = len(index['skills']) if isinstance(index.get('skills'), dict) else None
    except (OSError, ValueError):
        published = None
    return drafts, activated, published


@contextmanager
def _team_readonly():
    """Use the existing ledger without its write/initialization transaction."""
    if TEAM_DB.is_symlink() or any(p.is_symlink() for p in TEAM_DB.parents):
        raise ValueError('linked_team_ledger')
    db = sqlite3.connect(TEAM_DB.resolve().as_uri() + '?mode=ro', uri=True, timeout=3)
    try:
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA query_only=ON')
        yield db
    finally:
        db.close()


def _case_totals():
    """Status distribution only; a tail of events cannot prove time to resolve."""
    try:
        with _team_readonly() as db:
            counts = {row['status']: row['n'] for row in
                      db.execute('SELECT status,COUNT(*) AS n FROM cases GROUP BY status')}
    except (OSError, sqlite3.Error, ValueError) as error:
        return {'error': type(error).__name__}
    return {'counts': counts, 'scope': 'all cases in the existing project ledger',
            'resolvedSampled': 0, 'resolutionMedianMinutes': None,
            'note': '完整结案时长尚未评估；不使用最后20条事件冒充工单起止。'}


def _flag_history(rows, *, persist=True):
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
    if persist:
        with path.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps({'at': now, 'flags': sorted(current)}, ensure_ascii=False) + '\n')
    first = {}
    try:
        for line in path.read_text(encoding='utf-8').splitlines():
            if not line.strip():
                continue
            record = json.loads(line)
            present = set(record.get('flags') or [])
            first = {key: at for key, at in first.items() if key in present}
            for key in present:
                first.setdefault(key, record.get('at'))
    except (OSError, ValueError):
        pass
    ages = []
    for key in sorted(current):
        seen = first.get(key, now)
        ages.append({'flag': key, 'minutes': round((now - seen) / 60.0, 1)})
    ages.sort(key=lambda item: -item['minutes'])
    return ages


def metrics(rows, *, persist=True):
    """第 4 层：把"改进是否让下一轮更好"变成数。

    只统计数据真的支持的东西；支持不了的就写明没有记录 —— 编一个好看的数比没有数更糟，
    因为它会让下一轮的自改变成优化一个幻觉。
    """
    drafts, activated, published = _learning_totals(rows)
    cases = _case_totals()
    survival = None
    try:
        shared = SURVIVAL_METRICS
        if shared.exists():
            value = json.loads(shared.read_text(encoding='utf-8'))
            survival = {'schema': value.get('schema'), 'evidence': value.get('evidence'),
                        'generation': value.get('generation'), 'behaviors': value.get('behaviors'),
                        'runtime': value.get('runtime'),
                        'trends': value.get('trends'), 'note': value.get('note'),
                        'at': value.get('at'), 'ageMinutes': round((time.time() - (value.get('at') or 0)) / 60, 1),
                        'closedLoop': value.get('closedLoop'), 'repeats': value.get('repeats'),
                        'decisionGaps': value.get('decisionGaps'), 'stalledGoals': value.get('stalledGoals'),
                        'noOutputSignals': value.get('noOutputSignals'),
                        'noActionReviews': value.get('noActionReviews')}
    except Exception:
        survival = None
    report = {
        'schema': 1, 'generatedAt': time.time(),
        'survival': survival,
        'skillLevel': {'drafts': drafts, 'activated': activated, 'sharedPublished': published,
                       'inherited': None,
                       'inheritedNote': '没有记录：learning/index.json 未记技能来源角色，'
                                        '所以"跨角色继承"目前无法计算 —— 要它成为数字，先让索引记来源。'},
        'cases': cases,
        'flagAges': _flag_history(rows, persist=persist),
        'honestLimits': [
            '技能级产出全为 0 时，任何"改进效果"都只能是相对基线说的，不能凭空说变好',
            '继承率需要索引记录来源角色；回退率需要 feedback 里有失败记录',
        ],
    }
    baseline = NOTES / 'metrics-baseline.json'
    if persist and not baseline.exists():
        baseline.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
        report['baselineRecorded'] = True
    if persist:
        (NOTES / 'metrics.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
    return report


def build_live_board():
    """Native PawApp GET projection. No model calls, actions or file writes."""
    rows = board_rows()
    return {'schema': 2, 'generatedAt': time.time(), 'roles': rows,
            'metrics': metrics(rows, persist=False), 'proposals': proposals(),
            'policy': POLICY_JSON(code_facts()),
            'scope': 'enabled agents in this project; retained evidence in the current memory epoch'}


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
        freeknobs='\n\n'.join(
            '- `%s`（%s）—— %s\n    管什么：%s\n    强系统什么样：%s\n    该先问什么：%s'
            % (k, v['kind'], v['why'], v.get('covers', '—'), v.get('yardstick', '—'), v.get('probes', '—'))
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
        lines.append('| %s%s | %s | %s | %d | %d | %s | %s |' % (
            row['role'],
            ('（经 %s）' % row['shiftVia']) if row.get('shiftVia') else '',
            shift.get('code') or '—',
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
             '%s\n'
             % (skill['drafts'], skill['activated'], skill['sharedPublished'],
                skill['inheritedNote'] if skill['inherited'] is None else skill['inherited'],
                json.dumps(numbers['cases'].get('counts', {}), ensure_ascii=False),
                numbers['cases'].get('resolvedSampled'),
                numbers['cases'].get('resolutionMedianMinutes'),
                '、'.join('%s=%.0f 分钟' % (item['flag'], item['minutes'])
                          for item in numbers['flagAges'][:3]) or '无',
                ('- 动作连贯性（生存侧自算，%.0f 分钟前）：闭环率 %s；重复占比 %s；决策间隔中位/最长 %ss/%ss；停滞目标 %s 个（最老 %s 分钟）'
                 % (numbers['survival']['ageMinutes'],
                    numbers['survival']['closedLoop'].get('rate') if numbers['survival'].get('closedLoop') else '—',
                    numbers['survival']['repeats'].get('share') if numbers['survival'].get('repeats') else '—',
                    (numbers['survival']['decisionGaps'] or {}).get('medianSeconds'),
                    (numbers['survival']['decisionGaps'] or {}).get('maxSeconds'),
                    (numbers['survival']['stalledGoals'] or {}).get('count'),
                    (numbers['survival']['stalledGoals'] or {}).get('oldestMinutes')))
                if numbers.get('survival') else '- 动作连贯性：生存侧还没写出共享文件（等下一个周期）'))
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
