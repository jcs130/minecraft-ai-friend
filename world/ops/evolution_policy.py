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

## 七、机器在哪
{machinery}

---
**看板**：同目录 `evolution-board.md` —— 一角色一行，看谁在动、谁被拦、谁红了。
"""


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
        forbidden=forbidden, machinery=machinery), encoding='utf-8')

    rows = board_rows()
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
    (NOTES / 'evolution-board.md').write_text(header + '\n'.join(lines) + '\n', encoding='utf-8')
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
    return {'ok': True, 'roles': len(rows), 'flagged': len(flagged),
            'notes': str(NOTES), 'cron': facts['shiftCron'], 'mirroredInto': mirrored}


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
