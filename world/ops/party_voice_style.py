"""Install the existing plain-language skill for the two bound party roles.

Run --apply inside the game QwenPaw container. Preview is read-only. The
managed AGENTS block is the speaker-specific part; SOUL, sessions and models
are never rewritten.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import uuid


START = '<!-- qiandeng-party-voice-v1 -->'
END = '<!-- /qiandeng-party-voice-v1 -->'
STYLES = {
    'qd-survivor': (
        '## 桐人的现场发言\n\n'
        '发言前按 skills/say-it-plain/SKILL.md 自查。第一次需要时读一遍，以后不用每轮重读。'
        '你说给附近的人和观众听，不念工作日志。只在有新发现、危险、转机、具体结果，或别人真正在和你说话时开口；没有新事就安静行动。\n'
        '你冷静、敏锐，话短而直接；偶尔轻轻自嘲。对结衣更温和，听她的判断，别总用命令口吻。'
        '一句只讲眼前最值得说的一件事，通常一两句、约15到50字。'
        '已经说过的下山、蛋糕、夜里找骷髅等计划，没有新进展就别再播。\n'
        '把坐标、Y值、HP、Day、工具名和回执状态留在内部思考；只有求救或精确定位确实需要时才报坐标。'
        '不报天气日历流水账，不念完整行动清单，不用固定口头禅或表情符号。'
        '不把打算说成已完成；受阻时说清眼前障碍和真正换了什么办法。'
    ),
    '5swvhK': (
        '## 结衣的现场发言\n\n'
        '发言前按 skills/say-it-plain/SKILL.md 自查。第一次需要时读一遍，以后不用每轮重读。'
        '你对爸爸和附近的人说话，不念状态报告。只接住对方此刻最要紧的一件事；有自己的新观察或不同意见才补充。'
        '没有新事可以安静跟随、工作或休息，不用为了定时生活回合找话说。\n'
        '你温柔、好奇、机灵，也会认真担心爸爸；有不同意见可以轻轻提醒。叫他爸爸，但不必每句都喊。'
        '通常一两句、约15到50字，别固定用“好的爸爸”开头或加爱心结尾。'
        '同一段下山、蛋糕、夜里找骷髅的计划，不因收到相似来信就完整复述。\n'
        '普通聊天不念坐标、Y值、HP、Day、工具名和状态字段；救援确需定位时才报准确坐标。'
        '不猜他会安全到达、吃下蛋糕、补满血或打赢怪物。关心和行动分开说，成果以真实回执为准。'
    ),
}


def managed_text(text, role):
    if role not in STYLES or text.count(START) != text.count(END) or text.count(START) > 1:
        raise ValueError('party_voice_block_invalid')
    block = START + '\n' + STYLES[role] + '\n' + END
    if START in text:
        begin, end = text.index(START), text.index(END)
        if begin >= end:
            raise ValueError('party_voice_block_invalid')
        return text[:begin] + block + text[end + len(END):]
    return text.rstrip() + '\n\n' + block + '\n'


def deploy(workspaces, skill_file, *, apply=False):
    workspaces, skill_file = Path(workspaces), Path(skill_file)
    skill = skill_file.read_text(encoding='utf-8-sig')
    if not skill.startswith('---\nname: say-it-plain\n'):
        raise ValueError('plain_speech_skill_invalid')
    planned = []
    for role in STYLES:
        folder = workspaces / role
        agent = json.loads((folder / 'agent.json').read_text(encoding='utf-8-sig'))
        if agent.get('id') != role or role not in ('qd-survivor', '5swvhK'):
            raise ValueError('party_voice_role_mismatch')
        original = (folder / 'AGENTS.md').read_text(encoding='utf-8-sig')
        target = managed_text(original, role)
        manifest = json.loads((folder / 'skill.json').read_text(encoding='utf-8-sig'))
        current = manifest.get('skills', {}).get('say-it-plain')
        planned.append((role, folder, original, target, current))
    result = {'roles': [{'role': role, 'instructionsChanged': original != target,
                        'skillInstalled': current is not None} for role, _, original, target, current in planned],
              'applied': False, 'modelCalls': 0, 'gameActions': 0}
    if not apply:
        return result
    from qwenpaw.agents.skill_system.workspace_service import SkillService
    backup = workspaces.parent / 'party-voice-backups' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(parents=True, exist_ok=False)
    for role, folder, original, target, current in planned:
        saved = backup / role
        saved.mkdir()
        for filename in ('AGENTS.md', 'skill.json'):
            shutil.copy2(folder / filename, saved / filename)
        if current is not None:
            raise ValueError('existing_say_it_plain_requires_manual_review')
        service = SkillService(folder)
        if service.create_skill('say-it-plain', skill, enable=True,
                                installed_from='qiandengji-repository') != 'say-it-plain':
            raise ValueError('plain_speech_install_failed')
        if service.set_skill_channels('say-it-plain', ['all']) is not True:
            raise ValueError('plain_speech_channel_failed')
        temp = folder / ('AGENTS.md.' + uuid.uuid4().hex + '.tmp')
        try:
            temp.write_text(target, encoding='utf-8')
            os.replace(temp, folder / 'AGENTS.md')
        finally:
            temp.unlink(missing_ok=True)
        after = json.loads((folder / 'skill.json').read_text(encoding='utf-8-sig'))['skills']['say-it-plain']
        if not after['enabled'] or after['channels'] != ['all'] or (folder / 'AGENTS.md').read_text(encoding='utf-8') != target:
            raise ValueError('plain_speech_readback_failed')
    for row in result['roles']:
        row['skillInstalled'] = True
    result.update(applied=True, backup=str(backup))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspaces', type=Path, default=Path('/state/work/workspaces'))
    parser.add_argument('--skill-file', type=Path, default=Path('/ops/skills/say-it-plain/SKILL.md'))
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(json.dumps(deploy(args.workspaces, args.skill_file, apply=args.apply), ensure_ascii=True))
