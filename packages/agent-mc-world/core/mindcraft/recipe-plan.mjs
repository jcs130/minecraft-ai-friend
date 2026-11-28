// Adapted from Mindcraft's getDetailedCraftingPlan / craftItem. See LICENSE.
export function detailedCraftingPlan(bot, data, targetItem, count=1) {
  if (!Object.hasOwn(bot.registry.itemsByName,targetItem) || !Number.isSafeInteger(count) || count<1 || count>2304)
    throw new TypeError('Expected a registered item id and an integer count in 1..2304');
  const stock=new Map();
  for (const item of bot.inventory.items()) stock.set(item.name,(stock.get(item.name) ?? 0)+item.count);
  const steps=[], missing=new Map(), cache=new Map();
  const recipesFor=name=>{
    if (!cache.has(name)) {
      const tagged=bot.taggedIngredients(name);
      const raw=tagged.length ? tagged : (data.getItemCraftingRecipes(name) ?? []).map(([ingredients,result])=>({
        slots:Object.entries(ingredients).flatMap(([item,n])=>Array.from({length:n},()=>[item])),output:result.craftedCount
      }));
      cache.set(name,raw.filter(r=>r.output>0 && r.slots.length>0));
    }
    return cache.get(name);
  };
  // Prefer a material already present, then a material whose direct inputs are present.
  const score=name=>stock.get(name)>0 ? 2 : +recipesFor(name).some(r=>r.slots.every(opts=>opts.some(n=>stock.get(n)>0)));
  const best=choices=>choices.reduce((a,b)=>score(b)>score(a)?b:a);
  const chain=new Set();
  let nodes=0,limited=false;
  function supply(name,n) {
    const held=stock.get(name) ?? 0;
    const used=Math.min(n,held);
    stock.set(name,held-used);
    const needed=n-used;
    if (!needed) return;
    if (++nodes>256 || chain.size>=16) limited=true;
    const options=limited || chain.has(name) ? [] : recipesFor(name);
    if (!options.length) { missing.set(name,(missing.get(name) ?? 0)+needed); return; }
    const quality=r=>r.slots.reduce((n,slot)=>n+Math.max(...slot.map(score)),0)/r.slots.length;
    const recipe=options.reduce((a,b)=>quality(b)>quality(a)?b:a);
    const applications=Math.ceil(needed/recipe.output);
    const simulated=new Map(stock), inputs=new Map();
    for (const slot of recipe.slots) {
      let remaining = applications;
      for (const item of slot) {
        const held = simulated.get(item) ?? 0;
        const take = Math.min(remaining, held);
        if (!take) continue;
        simulated.set(item, held - take);
        inputs.set(item, (inputs.get(item) ?? 0) + take);
        remaining -= take;
        if (!remaining) break;
      }
      if (remaining) {
        const item = best(slot);
        inputs.set(item, (inputs.get(item) ?? 0) + remaining);
      }
    }
    chain.add(name);
    for (const [item,amount] of inputs) supply(item,amount);
    chain.delete(name);
    steps.push({item:name,applications,output:applications*recipe.output});
    stock.set(name,(stock.get(name) ?? 0)+applications*recipe.output-needed);
  }
  supply(targetItem,count);
  return {source:'version-registry',target:targetItem,count,steps,ready:!limited && missing.size===0,missing:Object.fromEntries(missing),limited};
}
