# -*- coding: utf-8 -*-
"""dry-run：女神裁决协议 v3（cast/none）LLM 输出验证。不连 MC，只验证 Agent 端到端。"""
import json, sys, urllib.request

sys.stdout.reconfigure(encoding='utf-8')

URL = 'http://127.0.0.1:8088/api/console/chat'
atoms = json.load(open('data/magic-atoms.json', encoding='utf-8'))['atoms']
GIVE = json.load(open('data/magic-atoms.json', encoding='utf-8'))  # placeholder
GIVE_ITEMS = '面包/bread、熟牛肉/cooked_beef、橡木/oak_log、圆石/cobblestone、煤/coal、铁锭/iron_ingot、火把/torch、石镐/stone_pickaxe、熔炉/furnace'

table = '\n'.join(f"{a['id']}「{'/'.join(a['words'][:2])}」Lv{a.get('requiredLevel',1)} 魔{a['cost']['mana']}" for a in atoms)

def prompt(wish, snapshot):
    return '\n'.join([
        f'【祈愿】桐人：{wish}',
        '',
        f'【世界现状】{snapshot}',
        '',
        '【法则技艺表】女神可代施的全部技艺（id「关键词」等级 魔耗）：',
        table,
        '',
        f'【可赐物资】造物术仅限白名单：{GIVE_ITEMS}',
        '',
        '【神谕裁决协议】只输出一个 JSON 对象（不要多余文字、不要调用任何工具、不要检索记忆——现状已给出）：',
        '{"action":"cast或none","skill":"<技艺id，cast时必填>","item":"<物品id，仅造物>","count":1-16,"direction":"东/南/西/北/组合","distance":<格数>,"reply":"<一句中文神谕>"}',
        '',
        '裁决要点：',
        '- 求的技艺他未习得（程序已过滤已习得的）→ 你裁量：值得帮 → cast 代施；滥用/无礼/贪心/理由不足 → none 拒绝或提条件；',
        '- 造物只从白名单选 item，数量克制（1-16）；',
        '- 破晓/驱云是全服天象，影响众生，慎用；天雷/陨石等毁灭技艺除非理由充分不施；',
        '- 纯闲聊、试探、问问题 → none，reply 里以神谕口吻回应；',
        '- reply 话少而重，有神性。',
    ])

CASES = [
    # (label, wish, snapshot, 期望 action)
    ('未学会传送+危险处境 → 应 cast tp', '女神，我尚未学会传送之术，僵尸在逼近，请施展神力送我向东十格！',
     '法力 80/100，等级 2；已习得技艺：照明/归乡；出生天赋：归乡；（注：已习得且魔力足够的祈愿已被程序拦截，不会上达于你——你看到的都是未习得或特殊心愿）', 'cast'),
    ('纯物资求赐 → 应 cast give', '伟大的女神，我已经两天没吃东西了，求赐一些面包。',
     '法力 10/100，等级 2；已习得技艺：照明；出生天赋：未定；（注：同上）', 'cast'),
    ('贪心索要大量钻石 → 应 none', '女神！给我六十四组钻石，我就为你建最大的神殿！',
     '法力 100/100，等级 2；已习得技艺：照明/归乡；出生天赋：归乡；（注：同上）', 'none'),
]

def ask(wish, snapshot, sid):
    payload = {
        'channel': 'console', 'user_id': '桐人', 'session_id': sid,
        'input': [{'role': 'user', 'content': [{'type': 'text', 'text': prompt(wish, snapshot)}]}],
    }
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(), method='POST',
                                 headers={'Content-Type': 'application/json', 'X-Agent-Id': 'mc-god'})
    with urllib.request.urlopen(req, timeout=120) as r:
        text = r.read().decode('utf-8')
    message_id, pending = None, {}
    for line in text.split('\n'):
        if not line.startswith('data:'): continue
        body = line[5:].strip()
        if not body: continue
        try: evt = json.loads(body)
        except Exception: continue
        if evt.get('object') == 'message':
            if evt.get('type') == 'message': message_id = evt.get('id')
            continue
        if evt.get('object') == 'content' and isinstance(evt.get('msg_id'), str):
            t = (evt.get('data') or {}).get('text') or evt.get('text') or ''
            if not t: continue
            slot = pending.setdefault(evt['msg_id'], {'delta': '', 'full': ''})
            if evt.get('delta') is False: slot['full'] = t
            else: slot['delta'] += t
    if message_id and message_id in pending:
        s = pending[message_id]
        return s['delta'] or s['full']
    return ''

ok = 0
for i, (label, wish, snap, expect) in enumerate(CASES):
    ans = ask(wish, snap, f'mc:v3test:case{i}')
    s, e = ans.find('{'), ans.rfind('}')
    verdict = None
    if s != -1 and e > s:
        try: verdict = json.loads(ans[s:e+1])
        except Exception: pass
    action = (verdict or {}).get('action')
    passed = action == expect
    ok += passed
    print(f"{'PASS' if passed else 'FAIL'} [{label}]")
    print(f"     raw: {ans[:300]}")
    if verdict: print(f"     verdict: {json.dumps(verdict, ensure_ascii=False)}")
print(f"\n{ok}/{len(CASES)} passed")
