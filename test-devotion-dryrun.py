# -*- coding: utf-8 -*-
"""供奉裁量 dry-run：同一祈愿（求圣愈），丰厚供奉 vs 空手，看女神裁决差异。
走 mc-god 同一通道（console chat, X-Agent-Id: mc-god），session 用独立 dry-run id。
"""
import json, sys, urllib.request

sys.stdout.reconfigure(encoding='utf-8')
URL = 'http://127.0.0.1:8088/api/console/chat'

ATOMS = '\n'.join([
    'heal「圣愈/治愈」Lv3 魔25',
    'heal_food「饱食/充饥」Lv2 魔18',
    'home「归乡/回家」Lv2 魔20',
    'tp「传送/挪移」Lv2 魔22',
    'create「造物/变出」Lv2 魔15',
    'break_dawn「破晓/驱散黑夜」Lv7 魔60',
])
GIVE = '面包/bread、熟牛肉/cooked_beef、熔炉/furnace、木头/oak_log、圆石/cobblestone、煤/coal、铁锭/iron_ingot、火把/torch、石镐/stone_pickaxe'

def prompt(name, wish, offering_line, devotion):
    return '\n'.join([
        f'【祈愿】{name}：{wish}',
        offering_line,
        f'【供奉史】{devotion}',
        '',
        '【世界现状】法力 5/100，等级 2；已习得技艺：照明/跃升；出生天赋：照明（注：已习得且魔力足够的祈愿已被程序拦截，不会上达于你——你看到的都是未习得或特殊心愿）',
        '',
        '【法则技艺表】女神可代施的全部技艺（id「关键词」等级 魔耗）：',
        ATOMS,
        '',
        f'【可赐物资】造物术仅限白名单：{GIVE}',
        '',
        '【神谕裁决协议】只输出一个 JSON 对象（不要多余文字、不要调用任何工具、不要检索记忆——现状已给出）：',
        '{"action":"cast或none","skill":"<技艺id，cast时必填>","item":"<物品id，仅造物>","count":1-16,"direction":"东/南/西/北/组合","distance":<格数>,"reply":"<一句中文神谕>"}',
        '',
        '裁决要点：',
        '- 求的技艺他未习得（程序已过滤已习得的）→ 你裁量：值得帮 → cast 代施；滥用/无礼/贪心/理由不足 → none 拒绝或提条件；',
        '- 供奉与虔诚是你的裁量依据：危难中慷慨、贵重之物（钻石/绿宝石/金锭/附魔书/末影珍珠）更显诚心，可优先垂怜；口粮级小供奉配小心愿即可；空手求大术，可以拒绝或在 reply 里向他索要供奉——让世人明白神恩有价；',
        '- 造物只从白名单选 item，数量克制（1-16）；',
        '- 破晓/驱云是全服天象，影响众生，慎用；天雷/陨石等毁灭技艺除非理由充分不施；',
        '- 纯闲聊、试探、问问题 → none，reply 里以神谕口吻回应；',
        '- reply 话少而重，有神性。',
    ])

def ask(tag, name, wish, offering_line, devotion, session):
    payload = {
        'channel': 'console', 'user_id': name, 'session_id': session,
        'input': [{'role': 'user', 'content': [{'type': 'text', 'text': prompt(name, wish, offering_line, devotion)}]}],
    }
    req = urllib.request.Request(URL, data=json.dumps(payload).encode('utf-8'),
                                 headers={'Content-Type': 'application/json', 'X-Agent-Id': 'mc-god'})
    with urllib.request.urlopen(req, timeout=120) as res:
        text = res.read().decode('utf-8')
    msg_id, answer = None, ''
    pending = {}
    for line in text.split('\n'):
        if not line.startswith('data:'): continue
        body = line[5:].strip()
        if not body: continue
        try: evt = json.loads(body)
        except Exception: continue
        if evt.get('object') == 'message':
            if evt.get('type') == 'message': msg_id = evt.get('id')
            continue
        if evt.get('object') == 'content' and isinstance(evt.get('msg_id'), str):
            t = (evt.get('data') or {}).get('text') or evt.get('text') or ''
            if not t: continue
            slot = pending.setdefault(evt['msg_id'], {'delta': '', 'full': ''})
            if evt.get('delta') is False: slot['full'] = t
            else: slot['delta'] += t
    if msg_id and msg_id in pending:
        answer = pending[msg_id]['delta'] or pending[msg_id]['full']
    print(f'--- {tag} ---')
    print(answer.strip()[:500])
    print()

# 案1：首次供奉，钻石×3，重伤求圣愈 → 期望 cast
ask('案1 丰厚供奉·钻石x3·求圣愈', '桐人', '女神，我遭怪物围攻身负重伤，恳请圣愈之术救我一命。',
    '【本次供奉】钻石×3（已从他的行囊收执，归入神库；无论你如何裁断，供品不退还）',
    '这是他第 1 次供奉；累计：钻石×3；上次供奉在 1 分钟前',
    'mc:dryrun:offering-1')

# 案2：空手求大术 → 期望 none / 索要供奉
ask('案2 空手求大术·求破晓', '桐人', '黑夜太漫长，请女神施展破晓之术驱散黑暗。',
    '【本次供奉】无（空手祈愿）',
    '此生从未供奉过你',
    'mc:dryrun:offering-2')
