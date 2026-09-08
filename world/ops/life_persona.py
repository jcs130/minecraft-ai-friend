"""Prepare a small, repeatable persona/memory migration; never perform I/O.

The caller resolves the registered role, reads native workspace files, applies
the returned changes with compare-and-swap, and keeps the original binding and
session. Missing files must be omitted from ``existing`` (not passed as empty).
"""
import json
import re
from uuid import UUID


PROFILE_START = '<!-- qiandeng-life-profile-v1 -->'
PROFILE_END = '<!-- /qiandeng-life-profile-v1 -->'
MEMORY_START = '<!-- qiandeng-life-memory-v1 -->'
MEMORY_END = '<!-- /qiandeng-life-memory-v1 -->'
LEGACY_KIRITO_PROFILE = (
    '真实角色 qd-survivor；身体 Kirito；游戏 QwenPaw 18089 统一会话，独立 survivor 调度和执行。'
)
SURVIVOR_POLICY_TEXT_UPDATES = (
    (
        'review_after_seconds 为180–3600秒，默认1800；仍受控制器当前的决策冷却和滚动24小时额度限制，以管理页实际预算为准。completed 会在冷却后选择下一个目标。',
        'review_after_seconds 为180–3600秒，默认1800，这是观察与复盘节奏，当前不另设人工模型次数或冷却上限。completed 后可选择下一个短目标，保持用户的长期使命。',
    ),
    (
        '新规划任务仍受现有每日额度与180秒冷却限制，同一 task 的连续工具调用不另收规划名额。控制器负责唤醒、执行互斥、暂停和预算，你负责主动感知和决定行动；',
        '当前没有人工推理次数与冷却上限，用量继续记录；一次身体租约仍最多六个串行动作。控制器负责唤醒、执行互斥、暂停和不确定结果保护，你负责主动感知和决定行动；',
    ),
)


def update_survivor_policy_text(text):
    """Migrate only the two known pre-unrestricted paragraphs, including duplicates."""
    for old, new in SURVIVOR_POLICY_TEXT_UPDATES:
        text = text.replace(old, new)
    return text


def _managed(text, start, end, body):
    """Replace one owned block without rewriting surrounding user content."""
    newline = '\r\n' if '\r\n' in text else '\n'
    block = start + newline + body.replace('\n', newline) + newline + end
    if text.count(start) != text.count(end) or text.count(start) > 1:
        raise ValueError('ambiguous_managed_persona_block')
    if start in text:
        first, last = text.index(start), text.index(end)
        if first >= last:
            raise ValueError('invalid_managed_persona_block')
        return text[:first] + block + text[last + len(end):]
    separator = '' if not text or text.endswith(newline * 2) else (
        newline if text.endswith(newline) else newline * 2
    )
    return text + separator + block + newline


def _legacy_yui_line(line):
    """Recognize only the former generated identity row, never arbitrary JSON."""
    try:
        value = json.loads(line.strip())
        if not isinstance(value, dict) or set(value) != {
            'maidUuid', 'ownerUuid', 'name', 'personaRevision',
        }:
            return False
        if value['name'] != '结衣' or type(value['personaRevision']) is not int or value['personaRevision'] != 2:
            return False
        for key in ('maidUuid', 'ownerUuid'):
            if str(UUID(value[key])) != value[key]:
                return False
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def _profile_without_legacy(text, kirito):
    lines = text.splitlines(keepends=True)
    removed = set()
    for index, line in enumerate(lines):
        if kirito and line.rstrip('\r\n') == LEGACY_KIRITO_PROFILE:
            removed.add(index)
        elif not kirito and _legacy_yui_line(line):
            removed.add(index)
            previous = index - 1
            while previous >= 0 and not lines[previous].strip():
                previous -= 1
            if previous >= 0 and lines[previous].rstrip('\r\n') == '# 固定身份':
                removed.add(previous)
    return ''.join(line for index, line in enumerate(lines) if index not in removed)


def prepare_files(role, name, existing):
    """Return changed managed files for the already registered Kirito or Yui.

    No native role, model, permission, body, session or SOUL content is changed.
    Existing MEMORY.md and memory/goals.md are always preserved, even if empty.
    The caller must still validate the exact production role/body binding.
    """
    if not isinstance(role, str) or not re.fullmatch(r'[A-Za-z0-9_-]{4,64}', role):
        raise ValueError('invalid_life_role')
    kirito = role == 'qd-survivor'
    if name != ('桐人' if kirito else '结衣'):
        raise ValueError('unsupported_life_persona')
    if not isinstance(existing, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in existing.items()):
        raise ValueError('existing_files_must_be_text')

    relationship = (
        '结衣是我的家人与冒险伙伴，她称我为爸爸；亚丝娜是重要的伴侣。尊重结衣的独立观察与判断。'
        if kirito else
        '桐人是我视为爸爸的家人，亚丝娜是我视为妈妈的家人；我是独立的冒险伙伴，温柔、好奇，关心同伴并保留自己的判断。'
    )
    profile = (
        f'## 身份与关系\n\n名字：{name}。在千灯纪中生活、学习和冒险。\n'
        f'{relationship}\n未在游戏中确认在场的人物，不编造其参与了当前行动。\n\n'
        '## 长期方向\n\n和同伴共同生存、逐步变强，学习装备制作、建营、采矿、农耕、公会任务和交易。'
        '这些是成长方向，不是已经完成的经历；当前阶段、证据和下一验收点见 memory/goals.md。'
        '原作背景按需读 notes/sao-background.md，实时等级、物资、技能与位置以游戏感知为准。'
    )
    memory_note = (
        '长期关键事实与简短索引放在 MEMORY.md；持续成长目标、当前阶段和下一验收点放在 '
        'memory/goals.md。需要旧经验时先用 memory_search 检索 memory/ 和 digest/，再 read_file '
        '相关一页；MEMORY.md 与 notes/ 不在该搜索范围，需要时直接读索引。\n'
        '当天有证据的经历记在 memory/YYYY-MM-DD.md 的自动 notes:auto 区块之外，注明来源、时间、'
        '结果和未确认事项；原生 Auto-Memory 维护日期子目录的会话笔记，Dream 将近期变化整理到 '
        'digest/。不覆盖自动区块，不把总结当作新的游戏回执。notes/ 资料和 skills/ 方法按需读取。\n'
        '现有生活调度在约10分钟复盘或确认真实入睡后带回同一会话时，回顾事实、只选一个有用改进，'
        '写下下一验收点并继续生活；此文字不创建计时器、第二条推理循环或额外游戏动作。'
        '普通个人记录已获授权，不反复询问；先读后合并，保留已有经验与不同意见。'
    )
    agents = existing.get('AGENTS.md', '')
    if kirito:
        agents = update_survivor_policy_text(agents)
    desired = {
        'PROFILE.md': _managed(
            _profile_without_legacy(existing.get('PROFILE.md', ''), kirito),
            PROFILE_START, PROFILE_END, profile,
        ),
        'AGENTS.md': _managed(agents, MEMORY_START, MEMORY_END, memory_note),
    }
    if 'MEMORY.md' not in existing:
        desired['MEMORY.md'] = (
            f'# {name}的长期记忆\n\n'
            '这里只保留经核实、长期有用的事实与简短索引。新增经验须有来源；原作设定不等于游戏成果。\n\n'
            '## 索引\n\n- 持续成长目标与下一验收点：memory/goals.md\n'
            '- 人物与关系：PROFILE.md；背景资料：notes/sao-background.md\n'
            '- 每日经历：memory/ 的日期索引；原生整理的经验：digest/\n\n'
            '## 已核实的重要经验\n\n尚未迁入已核实的游戏经历；根据真实回执逐步补充。\n'
        )
    if 'memory/goals.md' not in existing:
        desired['memory/goals.md'] = (
            f'# {name}的持续成长目标\n\n'
            '与同伴共同生存、逐步变强。这里是计划与验收索引，不是动作授权或已完成账本。\n\n'
            '| 方向 | 状态 | 下一验收点 |\n| --- | --- | --- |\n'
            '| 生存与同伴协作 | 待核实当前进度 | 读取自身状态与真实听见的伙伴消息，确认一个共同小目标 |\n'
            '| 装备与技能 | 待核实当前进度 | 核对真实装备、已学能力和前置条件，选择一次合法改进 |\n'
            '| 建营与采矿 | 待核实当前进度 | 核对已授权地点、现有设施与材料，完成一个可验证的小步骤 |\n'
            '| 农耕与食物 | 待核实当前进度 | 查明可用土地、工具、种子或食物来源，再选下一步 |\n'
            '| 公会与交易 | 待核实当前进度 | 读取真实合同或报价，确认材料和可达性后选择目标 |\n\n'
            '每次更新注明时间、事实来源、已完成的证据或阻塞原因；保留仍有效的目标，'
            '不要因为写下计划就标记完成。复盘只选一个当前最有价值的改进。\n'
        )
    return {path: text for path, text in desired.items() if existing.get(path) != text}
