import { pathToFileURL } from 'node:url';
import { command as productionCommand } from './rcon-client.mjs';
import { giftCommand, validateApproval } from './goddess-creation.mjs';
const sendProduction = text => productionCommand(text, 5000);
function packet(text, prefix) {
  const lines = String(text).split(/\r?\n/).filter(line => line.startsWith(`${prefix} `));
  if (lines.length !== 1) throw new Error('authoritative gift receipt missing');
  return JSON.parse(lines[0].slice(prefix.length + 1));
}
export async function giftCatalog(send = sendProduction) {
  const catalog = packet(await send('mycli admin giftcatalog'), 'MC_GIFT_CATALOG');
  if (catalog.schema !== 1 || catalog.ready !== true || !catalog.gifts || typeof catalog.gifts !== 'object')
    throw new Error('gift catalog unavailable');
  return catalog;
}
export async function deliverGift(player, decision, request, send = sendProduction, preview = false, expectedRecipeHash = null) {
  validateApproval(decision);
  const catalog = await giftCatalog(send);
  const recipe = decision.gift ? catalog.gifts[decision.gift] : null;
  if (decision.gift && (!recipe || recipe.gift !== decision.gift || !/^[a-f0-9]{64}$/.test(recipe.hash)
      || decision.amount > recipe.maxAmount)) throw new Error('invalid catalog gift/amount');
  if (expectedRecipeHash !== null && (!decision.gift || recipe.hash !== expectedRecipeHash))
    throw new Error('gift recipe changed after approval; nothing delivered');
  const command = giftCommand(request, player, decision, recipe?.hash);
  if (preview) return { ok: true, dryRun: true, request, player, selection: decision.gift ? `gift:${decision.gift}` : decision.item,
    amount: decision.amount, recipe: recipe ?? null, command };
  let delivered, recovered = false;
  try {
    delivered = packet(await send(command), 'MC_GIFT_RESULT');
  } catch {
    // A timeout can occur after delivery. Read the same receipt, never resend.
    recovered = true;
  }
  if (delivered && delivered.request !== request) throw new Error('gift receipt request mismatch');
  if (delivered && delivered.ok !== true) return { ok: false, request, reason: delivered.reason ?? 'unknown' };
  const receipt = packet(await send(`mycli admin giftstatus ${request}`), 'MC_GIFT_RESULT');
  if (recovered && (receipt.ok !== true || receipt.phase !== 'verified'))
    return { ok: false, request, reason: 'uncertain' };
  if (receipt.ok !== true || receipt.phase !== 'verified' || receipt.request !== request || receipt.player !== player
      || receipt.selection !== (decision.gift ? `gift:${decision.gift}` : decision.item)
      || receipt.item !== (recipe?.item ?? decision.item)
      || receipt.amount !== decision.amount || receipt.after - receipt.before !== decision.amount
      || recipe && receipt.recipeHash !== recipe.hash) throw new Error('gift contents/receipt verification failed');
  return { ok: true, request, duplicate: delivered?.duplicate === true, recovered, receipt };
}
export async function run(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === 'catalog') return giftCatalog();
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (name === '--commit') { options.commit = true; continue; }
    if (!['--player', '--item', '--gift', '--amount', '--request'].includes(name) || !argv[i + 1])
      throw new Error('unknown or missing gift argument');
    const key = name.slice(2);
    if (Object.hasOwn(options, key)) throw new Error('duplicate gift argument');
    options[key] = argv[++i];
  }
  const decision = { decision: 'approve', amount: options.amount === undefined ? 1 : Number(options.amount),
    ...(options.item === undefined ? {} : { item: options.item }), ...(options.gift === undefined ? {} : { gift: options.gift }) };
  return deliverGift(options.player, decision, options.request, sendProduction, !options.commit);
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run().then(result => { console.log(JSON.stringify(result)); process.exitCode = result.ok === false ? 1 : 0; })
    .catch(error => { console.error(JSON.stringify({ ok: false, reason: error.message, retry: 'Do not create a new request to retry an uncertain grant; inspect the original receipt.' })); process.exitCode = 1; });
}
