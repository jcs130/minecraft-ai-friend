/**
 * test-saga —— 创世之笔闸门离线单测（纯函数，零 cordis/零网络）。
 * 运行：npx tsx test-saga.mts
 */
import { validateAtomProposal, validateQuestProposal, validateEventProposal, type Verdict } from './src/mc-saga.ts'

let pass = 0
let fail = 0
function check(name: string, v: Verdict<unknown>, expectOk: boolean, expectReason?: string) {
  const ok = v.ok === expectOk && (!expectReason || (v.ok === false && v.reason.includes(expectReason)))
  if (ok) { pass++; console.log(`  ok  ${name}`) } else { fail++; console.log(`FAIL  ${name} → ${JSON.stringify(v).slice(0, 140)}`) }
}

const existing = [
  { id: 'home', name: '归乡', words: ['回家', '归乡'] },
  { id: 'heal', name: '疗愈', words: ['治疗'] },
]

const goodAtom = {
  id: 'ember_gift', name: '炉火', words: ['炉火'], layer: 'effect',
  cost: { mana: 12, food: 0, hp: 0 }, requiredLevel: 1,
  commands: ['give {target} minecraft:torch 4', 'particle minecraft:flame {px} {py+1} {pz} 0.3 0.3 0.3 0.05 30'],
  reply: '炉火照归途。', particles: [], sounds: ['minecraft:block.fire.ambient'],
  title: '炉火', subtitle: '微光暖心', lore: '鸣人常在寒夜里挖矿，女神记下了他的煤。',
}
console.log('── atom 闸门 ──')
check('合法新咒', validateAtomProposal(goodAtom, existing), true)
check('id 重复', validateAtomProposal({ ...goodAtom, id: 'home' }, existing), false, '已存在')
check('咒语词撞车', validateAtomProposal({ ...goodAtom, words: ['回家'] }, existing), false, '冲突')
check('等级门槛越界', validateAtomProposal({ ...goodAtom, requiredLevel: 9 }, existing), false, '1-8')
check('魔力为0', validateAtomProposal({ ...goodAtom, cost: { mana: 0, food: 0, hp: 0 } }, existing), false, '1-60')
check('summon 越权', validateAtomProposal({ ...goodAtom, commands: ['summon minecraft:zombie {px} {py} {pz}'] }, existing), false, '白名单模板')
check('tnt 禁词', validateAtomProposal({ ...goodAtom, commands: ['give {target} minecraft:tnt 1'] }, existing), false, '禁忌之念')
check('中文进命令', validateAtomProposal({ ...goodAtom, commands: ['give {target} 火把 4'] }, existing), false)
check('非白名单造物', validateAtomProposal({ ...goodAtom, commands: ['give {target} minecraft:grass_block 1'] }, existing), false, '白名单')
check('layer 越权', validateAtomProposal({ ...goodAtom, layer: 'form' }, existing), false, 'layer=effect')

console.log('── quest 闸门 ──')
const goodQuest = {
  title: '炉火与寒夜', story: '鸣人深夜挖矿不辍，女神想看看他的诚意，也想还他一份暖。', target: 'Naruto',
  demandCn: '煤', demandCount: 8, deadlineMin: 240,
  reward: { xp: 30, itemCn: '火把', itemCount: 8, manaBonus: 5 },
}
check('合法神托', validateQuestProposal(goodQuest, ['Naruto', 'Kirito'], []), true)
check('受托人不在线', validateQuestProposal(goodQuest, ['Kirito'], []), false, '不在线')
check('重复受托', validateQuestProposal(goodQuest, ['Naruto'], ['Naruto']), false, '已有一桩')
check('供品不在词典', validateQuestProposal({ ...goodQuest, demandCn: '下界合金' }, ['Naruto'], []), false, '词典')
check('奖励越界', validateQuestProposal({ ...goodQuest, reward: { xp: 999, itemCn: null, itemCount: 0 } }, ['Naruto'], []), false, '0-100')

console.log('── event 闸门 ──')
const goodEvent = {
  name: '寒夜恩赐', type: 'airdrop', story: '寒夜里连陨三灯，女神以物予人。', delayMin: 3,
  airdrop: { loot: [{ id: 'diamond', count: 2 }, { id: 'bread', count: 3 }] },
}
check('合法空投', validateEventProposal(goodEvent), true)
check('空投物品越白名单', validateEventProposal({ ...goodEvent, airdrop: { loot: [{ id: 'tnt', count: 1 }] } }), false, '白名单')
check('空投数量越界', validateEventProposal({ ...goodEvent, airdrop: { loot: [{ id: 'diamond', count: 99 }] } }), false, '1-6')
check('神恩日合法', validateEventProposal({ name: '神恩日', type: 'festival', story: '众生辛苦，女神赐福一日。', delayMin: 5, festival: { effect: 'haste', amplifier: 1, durationMin: 120 } }), true)
check('神恩日负面效果', validateEventProposal({ name: '神罚日', type: 'festival', story: '女神动怒，众生受苦。', delayMin: 5, festival: { effect: 'instant_damage', amplifier: 1, durationMin: 120 } }), false, '不在白名单')
check('竞速合法', validateEventProposal({ name: '献纳竞速', type: 'trial', story: '谁先献上钻石，赏赐归谁。', delayMin: 2, trial: { demandCn: '钻石', demandCount: 1, windowMin: 30, reward: { xp: 50, itemCn: '火把', itemCount: 4 } } }), true)
check('竞速供品不在词典', validateEventProposal({ name: '献纳竞速', type: 'trial', story: '谁先献上下界合金。', delayMin: 2, trial: { demandCn: '下界合金', demandCount: 1, windowMin: 30 } }), false, '词典')
check('未知事件类型', validateEventProposal({ name: '血月降临', type: 'bloodmoon', story: '血月当空。', delayMin: 1 }), false, '未知事件类型')

console.log(`\n${fail === 0 ? 'ALL PASS' : 'HAS FAILURES'}: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
