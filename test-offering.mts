/**
 * test-offering.mts —— 供奉解析/收执协议单测（纯函数，离线跑）。
 * 用法：..\node_modules\.bin\tsx.CMD test-offering.mts
 */
import { resolveOfferingText, parseInventoryCounts, sumItemCount, OFFERING_ITEM_CN } from './src/mc-offering.ts'
import { splitWishOffering } from './src/mc-god.ts'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`FAIL  ${name} ${extra}`) }
}

console.log('== resolveOfferingText ==')
check('面包x3', resolveOfferingText('面包x3')?.id === 'minecraft:bread' && resolveOfferingText('面包x3')?.count === 3)
check('金锭×2', resolveOfferingText('金锭×2')?.id === 'minecraft:gold_ingot' && resolveOfferingText('金锭×2')?.count === 2)
check('钻石*1', resolveOfferingText('钻石*1')?.id === 'minecraft:diamond')
check('3个面包', resolveOfferingText('3个面包')?.count === 3 && resolveOfferingText('3个面包')?.id === 'minecraft:bread')
check('裸名默认1', resolveOfferingText('钻石')?.count === 1)
check('尾缀数字 面包2', resolveOfferingText('面包2')?.count === 2)
check('英文 bread 2', resolveOfferingText('bread 2')?.id === 'minecraft:bread' && resolveOfferingText('bread 2')?.count === 2)
check('minecraft:emerald 直填', resolveOfferingText('minecraft:emerald')?.id === 'minecraft:emerald')
check('附魔书', resolveOfferingText('附魔书x1')?.id === 'minecraft:enchanted_book')
check('末影珍珠', resolveOfferingText('末影珍珠x3')?.id === 'minecraft:ender_pearl')
check('未知物→null', resolveOfferingText('陨石') === null)
check('空串→null', resolveOfferingText('') === null)
check('数量上限64', resolveOfferingText('面包x9999')?.count === 64)
check('cn回显用中文', resolveOfferingText('diamond 2')?.cn === '钻石', `got ${resolveOfferingText('diamond 2')?.cn}`)

console.log('== parseInventoryCounts ==')
const sample = `Kirito has the following entity data: [{Slot: 0b, id: "minecraft:bread", Count: 5b}, {Slot: 1b, Count: 2b, id: "minecraft:gold_ingot"}, {Slot: 2b, id: "minecraft:diamond", Count: 1b}]`
const counts = parseInventoryCounts(sample)
check('bread=5', counts.get('bread') === 5)
check('gold_ingot=2（Count 在前也能解析）', counts.get('gold_ingot') === 2)
check('diamond=1', counts.get('diamond') === 1)
check('空回显', parseInventoryCounts('Kirito has the following entity data: []').size === 0)

console.log('== sumItemCount ==')
check('合计多格', sumItemCount([{ name: 'bread', count: 2 }, { name: 'minecraft:bread', count: 3 }, { name: 'coal', count: 9 }], 'minecraft:bread') === 5)

console.log('== splitWishOffering（祈愿私聊协议）==')
const a = splitWishOffering('伟大的女神，请送我回家｜供奉：面包x3')
check('wish 拆出', a.wish === '伟大的女神，请送我回家', `got ${a.wish}`)
check('offering 拆出', a.offeringText === '面包x3')
const b = splitWishOffering('请治愈我')
check('无供奉 → null', b.offeringText === null && b.wish === '请治愈我')
const c = splitWishOffering('求破晓|供奉:金锭x2')
check('半角分隔符', c.offeringText === '金锭x2', `got ${c.offeringText}`)
const d = splitWishOffering('我想供奉一些吃的')
check('正文提到供奉但无尾缀 → 不误拆', d.offeringText === null && d.wish.includes('供奉'), `got ${JSON.stringify(d)}`)

console.log('== OFFERING_ITEM_CN 反查 ==')
check('gold_ingot 有中文名', OFFERING_ITEM_CN['gold_ingot'] === '金锭')

console.log(`\n${fail === 0 ? 'ALL PASS' : 'HAS FAILURES'}: ${pass} pass, ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
