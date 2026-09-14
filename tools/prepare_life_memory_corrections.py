"""Read-only native GETs -> reviewable additive memory correction plan.

This script deliberately has no apply/rebuild/model API. The deployer uses
the official workspace PUT with these exact ETags after reviewing the plan.
Any concurrent change requires a new preview; never force an old overwrite.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'world/ops')]
from configure_life_memory import file_api

ROLE = 'qd-survivor'
SOURCE = ROOT / 'runtime/doom-followup-20260914T1510/native-task-summary.json'
JOURNAL = 'memory/2026-09-14/kirito-camp-farming-progress.md'
DIGESTS = ('digest/procedure/inventory-full-craft-blocked-slot-management.md',
           'digest/procedure/lease-expiry-dirt-placement-deadlock.md')
NOTE = 'notes/qiandeng-memory-corrections.md'
MARKER = '<!-- qiandeng-memory-correction-20260914-v1 -->'
END = '<!-- /qiandeng-memory-correction-20260914-v1 -->'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def add_note(content, text):
    """No replacement of past facts; prepend a dated, delimited correction."""
    if MARKER in content:
        raise ValueError('correction_already_present_review_required')
    at = 0
    if content.startswith('---\n') or content.startswith('---\r\n'):
        lines = content.splitlines(keepends=True)
        at = len(lines[0])
        for line in lines[1:]:
            at += len(line)
            if line.strip() == '---':
                break
        else:
            raise ValueError('invalid_frontmatter')
    note = '\n' + MARKER + '\n' + text + '\n' + END + '\n\n'
    return content[:at] + note + content[at:]


def proposal(output, getter=file_api, source=SOURCE):
    raw = Path(source).read_bytes(); audit = json.loads(raw)
    expected = {'numen_survival__status': 5, 'numen_survival__inspect_block': 16,
                'numen_survival__remember': 6, 'numen_survival__world_perception': 6}
    if (audit.get('taskId') != 'task-ed68bc2a7efb' or audit.get('callCounts') != expected
            or audit.get('bodyMutationCalls') != 0 or audit.get('leaseInvalidCount') != 0):
        raise ValueError('verified_historical_evidence_required')
    reference = ('2026-09-14 核对原生任务 task-ed68bc2a7efb：完整 33 次调用仅有状态/方块/感知读取和 '
        '6 次 remember，没有 eat。六次记忆只实际写入一次，最终是重复空感知导致 Doom；'
        '当时日志所写“吃甜菜根11→12”没有该轮动作回执支持，应读作未确认并保留此纠正。'
        '此处任务编号仅作历史引用，不是可复用的动作租约。')
    notes = {
        JOURNAL: '> 2026-09-14 纠正：' + reference + ' 参见 [[' + NOTE + ']] 的证据来源与范围。',
        DIGESTS[0]: ('> 2026-09-14 能力更新：本页反复放置方块的经历属于旧接口条件，不能推断为当前唯一或推荐办法。'
            '当前正式 drop_items 已提供组件保真的原生丢出与效果回执；方法与边界见 '
            '[[skills/qd-minecraft-guide/references/building.md]]。是否使用及物品选择仍由角色按任务决定；'
            '丢出不是储存、队友拾取或已发生的成果。旧来源全部保留。'),
        DIGESTS[1]: ('> 2026-09-14 纠正：反复失败的放置循环是失败记录，不应继续强化为通用整理流程。'
            '现有能力应以当前工具卡和 [[skills/qd-minecraft-guide/references/building.md]] 为准。'
            '旧租约、体征和坐标仅是当时状态，不是当前授权或永久指令；缺少有效租约时等待新的生活输入。'),
    }
    operations = []
    for path, text in notes.items():
        before = getter(ROLE, path)
        if before is None:
            raise ValueError('historical_source_missing:' + path)
        after = add_note(before['content'], text)
        inserted = '\n' + MARKER + '\n' + text + '\n' + END + '\n\n'
        preserved = after.replace(inserted, '', 1) == before['content']
        if not preserved:
            raise ValueError('historical_bytes_changed')
        operations.append({'method': 'PUT', 'role': ROLE, 'path': path, 'ifMatch': before['etag'],
            'beforeSha256': sha(before['content'].encode()), 'beforeContent': before['content'],
            'afterSha256': sha(after.encode()), 'content': after,
            'historyPreservedVerbatim': preserved})
    existing = getter(ROLE, NOTE)
    note = ('# 生活记忆纠正与来源\n\n' + reference + '\n\n'
        '只读原生 task API 与压缩前 dialog/2026-09-14.jsonl 第215–216行一致；项目脱敏核对文件 '
        '`runtime/doom-followup-20260914T1510/native-task-summary.json` SHA256 `' + sha(raw) + '`。\n\n'
        '当前工具卡的能力更新与实际动作成果分开记录。原日志、旧来源和链接保留；'
        '未来摘要应引用 notes/runtime-evidence/ 中对应的原生回执投影。\n')
    if existing is not None:
        raise ValueError('correction_note_exists_review_required')
    operations.insert(0, {'method': 'native-file-upload-no-overwrite', 'role': ROLE, 'path': NOTE,
        'content': note, 'afterSha256': sha(note.encode())})
    result = {'schema': 1, 'createdAt': datetime.now(timezone.utc).isoformat(),
        'mode': 'preview_only', 'sourceSha256': sha(raw), 'operations': operations,
        'modelCalls': 0, 'productionWrites': 0,
        'applyOrder': 'Create the correction source with native no-overwrite upload first; '
            'then PUT exact proposed bytes with If-Match after native memory jobs are quiescent. '
            'Archive this plan/original bytes; ETag conflict requires re-preview. Never edit dialog or mem_session.'}
    output = Path(output); output.mkdir(parents=True, exist_ok=False)
    (output / 'plan.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'mode': 'preview_only', 'operations': len(operations), 'plan': str(output / 'plan.json'),
            'productionWrites': 0, 'modelCalls': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps(proposal(args.output), ensure_ascii=True))
