package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.command.CommandSender;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataContainer;
import org.bukkit.persistence.PersistentDataType;

/** Explicit own-inventory maintenance. No selling, world drops or body queue. */
final class InventoryTidy {
    private static final String SETTINGS="inventory-tidy.";
    static final String STASH_PREVIEW="/mycli inventory tidy stash --dry-run --discard-common --json";
    private static final NamespacedKey VORTEX_ITEM=new NamespacedKey("vortexrpg","vortex_item_id");
    private static final NamespacedKey VORTEX_PROFESSION_ITEM=new NamespacedKey("vortexrpg","profession_item_id");
    private static final long AUTO_INTERVAL_MS=60_000;
    private static final Set<Material> COMMON=Set.of(Material.COBBLESTONE,Material.COBBLED_DEEPSLATE,
            Material.STONE,Material.DIRT,Material.ANDESITE,Material.DIORITE,Material.GRANITE,
            Material.GRAVEL,Material.CLAY,Material.CLAY_BALL,Material.ROTTEN_FLESH,
            Material.WHEAT_SEEDS,Material.BEETROOT_SEEDS,Material.POISONOUS_POTATO);
    private final AgentFriendPlugin plugin;
    private final Set<UUID> queued=new HashSet<>(),blocked=new HashSet<>();
    private final Set<UUID> blockedStashes=new HashSet<>();
    private final Map<UUID,Long> lastAuto=new HashMap<>();
    private final Map<UUID,Long> lastStashAuto=new HashMap<>();
    private CommandSender operator;
    InventoryTidy(AgentFriendPlugin plugin){this.plugin=plugin;}
    static boolean common(ItemStack item){return item!=null&&COMMON.contains(item.getType())&&!item.hasItemMeta();}
    private static boolean plain(ItemStack item){return item!=null&&!item.getType().isAir()&&!item.hasItemMeta();}
    private static int used(ItemStack[] items){int n=0;for(ItemStack i:items)if(i!=null&&!i.getType().isAir())n++;return n;}
    private static ItemStack[] copy(ItemStack[] items){return Arrays.stream(items).map(i->i==null?null:i.clone()).toArray(ItemStack[]::new);}
    record Plan(ItemStack[] after,int beforeUsed,int afterUsed,int merged,Map<Material,Integer> discarded) {}
    static Plan plan(ItemStack[] before,boolean discard) {
        if(before.length!=36)throw new IllegalArgumentException("Only the 36 personal storage slots may be tidied");
        return plan(before,discard,9);
    }
    private static Plan plan(ItemStack[] before,boolean discard,int first) {
        ItemStack[] after=copy(before);int merged=0;Map<Material,Integer> removed=new LinkedHashMap<>();
        // Preserve all custom components and, for the carried bag, hotbar positions.
        Map<Material,List<ItemStack>> partials=new EnumMap<>(Material.class);
        for (int slot=first;slot<after.length;slot++) {
            ItemStack source=after[slot];
            if (!plain(source)) continue;
            var targets=partials.computeIfAbsent(source.getType(),ignored->new ArrayList<>());
            for (var iterator=targets.iterator();iterator.hasNext()&&source.getAmount()>0;) {
                ItemStack target=iterator.next();
                if (!target.isSimilar(source)) continue;
                int amount=Math.min(source.getAmount(),target.getMaxStackSize()-target.getAmount());
                target.setAmount(target.getAmount()+amount);
                source.setAmount(source.getAmount()-amount);
                merged+=amount;
                if (target.getAmount()==target.getMaxStackSize()) iterator.remove();
            }
            if (source.getAmount()==0) after[slot]=null;
            else if (source.getAmount()<source.getMaxStackSize()) targets.add(source);
        }
        if(discard)for(int slot=first;slot<after.length;slot++)if(common(after[slot])) {
            removed.merge(after[slot].getType(),after[slot].getAmount(),Integer::sum);after[slot]=null;
        }
        if (first == 0) {
            var ordered = Arrays.stream(after).filter(item -> item != null && !item.getType().isAir())
                .sorted(Comparator.comparingInt(InventoryTidy::stashPriority)).toList();
            Arrays.fill(after, null);
            for (int slot = 0; slot < ordered.size(); slot++) after[slot] = ordered.get(slot);
        }
        return new Plan(after,used(before),used(after),merged,Collections.unmodifiableMap(removed));
    }
    private static int stashPriority(ItemStack item) {
        String material = item.getType().name();
        if (DungeonLoadoutRules.melee(material) || material.endsWith("_HELMET") || material.endsWith("_CHESTPLATE")
                || material.endsWith("_LEGGINGS") || material.endsWith("_BOOTS")
                || item.getType() == Material.BOW || item.getType() == Material.CROSSBOW || item.getType() == Material.SHIELD) return 0;
        if (item.hasItemMeta()) {
            var data = item.getItemMeta().getPersistentDataContainer();
            if (data.has(VORTEX_PROFESSION_ITEM) || vortexCombatFocus(item.getType(), data)) return 0;
        }
        return common(item) ? 2 : 1;
    }
    static boolean vortexCombatFocus(Material material, PersistentDataContainer data) {
        return switch (material) {
            case BLAZE_ROD, BOOK, BONE, CLOCK -> data.has(VORTEX_ITEM);
            default -> false;
        };
    }
    private boolean enabled(Player p){return plugin.getConfig().getBoolean(SETTINGS+p.getUniqueId()+".enabled",false);}
    private boolean discard(Player p){return plugin.getConfig().getBoolean(SETTINGS+p.getUniqueId()+".discard-common",false);}
    private String stashAutoPath(Player p){return SETTINGS+p.getUniqueId()+".stash-auto";}
    private boolean stashAuto(Player p){return plugin.getConfig().getBoolean(stashAutoPath(p),false);}
    private String blocker(Player p) {
        if(!p.isOnline()||p.isDead()||plugin.isDowned(p))return "player_unavailable";
        if(plugin.isObserver(p)||!Set.of(GameMode.SURVIVAL,GameMode.ADVENTURE).contains(p.getGameMode()))return "survival_required";
        if(plugin.pvpParticipant(p))return "pvp_inventory_locked";
        if(blocked.contains(p.getUniqueId()))return "save_unverified";
        if(!Set.of(InventoryType.CRAFTING,InventoryType.PLAYER).contains(p.getOpenInventory().getTopInventory().getType())
                ||p.getItemOnCursor()!=null&&!p.getItemOnCursor().getType().isAir())return "close_container_first";
        return null;
    }
    boolean queueAuto(Player p) {
        if(!enabled(p)||p.getInventory().firstEmpty()>=0||blocker(p)!=null)return false;
        UUID id=p.getUniqueId();long now=System.currentTimeMillis();
        lastAuto.entrySet().removeIf(entry->now-entry.getValue()>=AUTO_INTERVAL_MS);
        if(queued.contains(id)||now-lastAuto.getOrDefault(id,0L)<AUTO_INTERVAL_MS)return false;
        queued.add(id);lastAuto.put(id,now);
        Bukkit.getScheduler().runTask(plugin,()->{queued.remove(id);if(enabled(p)&&p.getInventory().firstEmpty()<0)run(p,false,discard(p),true);});
        return true;
    }
    void forget(UUID id){queued.remove(id);lastStashAuto.remove(id);}
    void operator(Player p,String[] args,CommandSender sender) {
        if(operator!=null)throw new IllegalStateException("Nested inventory operator");
        operator=sender;try{command(p,args);}finally{operator=null;}
    }
    void command(Player p,String[] args) {
        boolean preview=false,drop=false;List<String> words=new ArrayList<>();
        for(int n=2;n<args.length;n++)switch(args[n]) {
            case "--dry-run"->preview=true;case "--discard-common"->drop=true;case "--json"->{}
            default->{if(args[n].startsWith("--")){failure(p,"invalid_argument","/mycli inventory tidy --help");return;}words.add(args[n]);}
        }
        if(!words.isEmpty()) {
            if(words.equals(List.of("stash"))){runStash(p,preview,drop,false);return;}
            if(words.size()==3&&words.getFirst().equals("stash")&&words.get(1).equals("auto")) {
                if(preview||drop||!Set.of("on","off","status").contains(words.getLast())) {
                    failure(p,"invalid_argument","/mycli inventory tidy stash auto status");return;
                }
                stashAutoCommand(p,words.getLast());return;
            }
            if(words.size()!=2||!words.getFirst().equals("auto")||!Set.of("on","off","status").contains(words.getLast())||preview
                    ||drop&&!words.getLast().equals("on")){failure(p,"invalid_argument","/mycli inventory tidy auto status");return;}
            String action=words.getLast();
            if(!action.equals("status")) {
                String path=SETTINGS+p.getUniqueId();Object oldEnabled=plugin.getConfig().get(path+".enabled"),oldDiscard=plugin.getConfig().get(path+".discard-common");
                try{plugin.getConfig().set(path+".enabled",action.equals("on"));plugin.getConfig().set(path+".discard-common",action.equals("on")&&drop);plugin.saveConfig();}
                catch(RuntimeException error){plugin.getConfig().set(path+".enabled",oldEnabled);plugin.getConfig().set(path+".discard-common",oldDiscard);failure(p,"settings_save_unverified","/mycli inventory tidy auto status");return;}
            }
            JsonObject out=base(p,"auto",true,"ok");out.addProperty("enabled",enabled(p));out.addProperty("discardCommon",discard(p));out.addProperty("minimumIntervalSeconds",AUTO_INTERVAL_MS/1000);
            JsonArray types=new JsonArray();COMMON.stream().sorted().forEach(m->types.add(m.getKey().toString()));out.add("discardWhitelist",types);
            p.sendMessage("§b【自动整理】"+(enabled(p)?"已开启":"已关闭")+"；仅背包满时运行，最多每60秒一次；"+(discard(p)?"会销毁白名单普通杂物，包括任务可能需要的普通石头/泥土":"仅合并堆叠，不销毁")+"。快捷栏、装备和带特殊标记的物品保留。关闭：/mycli inventory tidy auto off");reply(p,out);return;
        }
        run(p,preview,drop,false);
    }
    private void stashAutoCommand(Player p,String action) {
        if (!action.equals("status")) {
            String stop=blocker(p);
            if(stop!=null){failure(p,stop,"/mycli inventory tidy stash auto status");return;}
            String path=stashAutoPath(p);
            Object previous=plugin.getConfig().get(path);
            try {
                plugin.getConfig().set(path,action.equals("on"));
                plugin.saveConfig();
                lastStashAuto.remove(p.getUniqueId());
            } catch (RuntimeException error) {
                plugin.getConfig().set(path,previous);
                failure(p,"settings_save_unverified","/mycli inventory tidy stash auto status");return;
            }
        }
        boolean enabled=stashAuto(p);
        JsonObject out=base(p,"stash_auto",true,"ok");
        out.addProperty("enabled",enabled);
        out.addProperty("discardCommon",false);
        out.addProperty("minimumIntervalSeconds",AUTO_INTERVAL_MS/1000);
        p.sendMessage("§b【个人箱自动整理】"+(enabled?"已开启":"已关闭")+"。开箱时合并普通堆叠、装备排在前面，最多每60秒一次。清理杂物预览："+STASH_PREVIEW);
        reply(p,out);
    }
    void onStashOpen(Player p) {
        if (!stashAuto(p) || blocker(p)!=null) return;
        UUID id=p.getUniqueId();
        long now=System.currentTimeMillis();
        if (now-lastStashAuto.getOrDefault(id,0L)<AUTO_INTERVAL_MS) return;
        lastStashAuto.put(id,now);
        runStash(p,false,false,true);
    }
    private void runStash(Player p,boolean preview,boolean drop,boolean automatic) {
        String stop=blocker(p);if(stop!=null){failure(p,stop,"/mycli inventory tidy stash --dry-run");return;}
        if (!preview && stashWritesBlocked(p.getUniqueId())) {failure(p,"save_unverified","/mycli arena stash list");return;}
        if (!preview && plugin.nativeRpgSelected() && (plugin.nativeRpg().blockPendingTrade(p)
                || plugin.nativeRpg().recyclingState(p).get("pending").getAsBoolean())) {
            if (!automatic) failure(p,"stash_trade_pending","/mycli trade recycle status");
            return;
        }
        ItemStack[] before=copy(plugin.dungeon().stashSnapshot(p.getUniqueId()).items());Plan plan=plan(before,drop,0);
        boolean changed=!Arrays.equals(before,plan.after());
        if (automatic&&!changed) return;
        if(!preview&&changed)try{plugin.dungeon().stageStashContents(p.getUniqueId(),plan.after());plugin.saveConfig();}
        catch(RuntimeException error){plugin.dungeon().stageStashContents(p.getUniqueId(),before);blockedStashes.add(p.getUniqueId());
            String request=UUID.randomUUID().toString();
            plugin.getLogger().severe("Stash tidy persistence unverified for "+p.getUniqueId()+" request="+request);
            p.sendMessage("§e[save_unverified] 个人箱整理存盘待核对；请联系服主，提供回执 "+request+"。");
            JsonObject out=base(p,"stash_tidy",false,"save_unverified");out.addProperty("requestId",request);out.add("changed",JsonNull.INSTANCE);out.addProperty("outcomeUnknown",true);out.addProperty("retrySameAction",false);reply(p,out);return;}
        int duplicates=0;List<ItemStack> unique=new ArrayList<>();List<Integer> copies=new ArrayList<>();
        for(ItemStack item:plan.after())if(ArenaEconomy.eligible(item)) {
            int match=-1;for(int n=0;n<unique.size();n++)if(unique.get(n).isSimilar(item)){match=n;break;}
            if(match<0){unique.add(item);copies.add(item.getAmount());}else copies.set(match,copies.get(match)+item.getAmount());
        }
        for(int count:copies)duplicates+=Math.max(0,count-2);
        JsonObject out=base(p,"stash_tidy",true,preview?"preview":changed?"completed":"unchanged");out.addProperty("scope","personal_stash_all_10_pages");out.addProperty("dryRun",preview);out.addProperty("changed",!preview&&changed);out.addProperty("automatic",automatic);
        out.addProperty("beforeOccupied",plan.beforeUsed());out.addProperty("afterOccupied",plan.afterUsed());out.addProperty("freedSlots",plan.beforeUsed()-plan.afterUsed());out.addProperty("mergedItems",plan.merged());out.addProperty("recyclableDuplicatesBeyondTwo",duplicates);
        out.addProperty("sortOrder","equipment_first_common_last");out.addProperty("queuedRewards",plugin.dungeon().queuedRewardEntries(p.getUniqueId()));
        JsonArray removed=new JsonArray();plan.discarded().forEach((m,count)->{JsonObject row=new JsonObject();row.addProperty("id",m.getKey().toString());row.addProperty("count",count);removed.add(row);});out.add("discarded",removed);
        String next=preview?"/mycli inventory tidy stash"+(drop?" --discard-common":"")+" --json"
            :plan.afterUsed()<PagedPersonalStash.CAPACITY?"/mycli arena stash page 1":"/mycli trade recycle list --json";
        out.addProperty("nextCommand",next);
        p.sendMessage("§b【个人箱整理"+(preview?"预览":"")+"】10页统一按装备在前、杂物在后排列。合并 "+plan.merged()+" 件，"+(preview?"预计释放 ":"已释放 ")
            +(plan.beforeUsed()-plan.afterUsed())+" 格；"+(preview?"预计销毁 ":"销毁 ")+plan.discarded().values().stream().mapToInt(Integer::intValue).sum()
            +" 件普通杂物。下一步 "+next+"。");reply(p,out);
    }
    boolean stashWritesBlocked(UUID id) {return blockedStashes.contains(id);}
    private void run(Player p,boolean preview,boolean drop,boolean automatic) {
        String stop=blocker(p);if(stop!=null){failure(p,stop,stop.equals("close_container_first")?"/mycli inventory tidy":"/mycli inventory");return;}
        ItemStack[] before=copy(p.getInventory().getStorageContents());Plan plan=plan(before,drop);
        boolean changed=!Arrays.equals(before,plan.after());String request=UUID.randomUUID().toString();
        if(!preview&&changed) {
            NamespacedKey key=new NamespacedKey(plugin,"inventory_tidy_save");
            try {
                p.getInventory().setStorageContents(plan.after());p.getPersistentDataContainer().set(key,PersistentDataType.STRING,request);
                p.saveData();PvpEscrowFiles.confirmPlayerSave(Bukkit.getWorlds().getFirst().getWorldFolder().toPath().resolve("playerdata").resolve(p.getUniqueId()+".dat"),key.toString(),request);
                p.updateInventory();
            } catch(Exception error) {
                p.getInventory().setStorageContents(before);p.updateInventory();blocked.add(p.getUniqueId());
                plugin.getLogger().severe("Inventory tidy persistence unverified for "+p.getUniqueId()+" request="+request+"; automatic tidy paused");
                JsonObject out=base(p,"tidy",false,"save_unverified");out.addProperty("requestId",request);out.add("changed",JsonNull.INSTANCE);out.addProperty("outcomeUnknown",true);out.addProperty("retrySameAction",false);
                p.sendMessage("§e[save_unverified] 整理存盘未确认，当前背包已恢复，自动整理暂停；请联系服主核对原请求 "+request+"，不要重复整理。");reply(p,out);return;
            } finally {p.getPersistentDataContainer().remove(key);}
        }
        JsonObject out=base(p,"tidy",true,preview?"preview":changed?"completed":"unchanged");
        out.addProperty("requestId",request);out.addProperty("dryRun",preview);out.addProperty("automatic",automatic);out.addProperty("discardCommon",drop);
        out.addProperty("changed",!preview&&changed);out.addProperty("beforeOccupied",plan.beforeUsed());out.addProperty("afterOccupied",plan.afterUsed());
        out.addProperty("freedSlots",plan.beforeUsed()-plan.afterUsed());out.addProperty("mergedItems",plan.merged());
        JsonArray removed=new JsonArray();plan.discarded().forEach((m,count)->{JsonObject row=new JsonObject();row.addProperty("id",m.getKey().toString());row.addProperty("count",count);removed.add(row);});out.add("discarded",removed);
        out.addProperty("nextCommand",plan.afterUsed()==36?"/mycli trade recycle list --json":"/mycli inventory");
        p.sendMessage("§b【背包整理"+(preview?"预览":"")+"】合并 "+plan.merged()+" 件，"+(preview?"将":"已")+"释放 "+(plan.beforeUsed()-plan.afterUsed())+" 格；"+(preview?"将销毁":"销毁")+"普通杂物 "+plan.discarded().values().stream().mapToInt(Integer::intValue).sum()+" 件。"+(!drop?"清理杂物需明确使用 --discard-common。":"")+"仍满时查 /mycli trade recycle list --json。");reply(p,out);
    }
    private JsonObject base(Player p,String action,boolean ok,String reason){JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("playerUuid",p.getUniqueId().toString());out.addProperty("action",action);out.addProperty("success",ok);out.addProperty("reason",reason);out.addProperty("serverOperator",operator!=null);return out;}
    private void failure(Player p,String reason,String next){
        JsonObject out=base(p,"tidy",false,reason);out.addProperty("changed",false);out.addProperty("nextCommand",next);out.addProperty("retrySameAction",false);
        if(reason.equals("save_unverified"))out.addProperty("previousOutcomeUnknown",true);
        String hint=switch(reason){
            case "close_container_first"->"先关闭箱子或其他容器，并放下鼠标上拿着的物品。";
            case "pvp_inventory_locked"->"先退出竞技场或等待原背包恢复；用 /mycli pvp status 查询。";
            case "survival_required"->"请从本人正常生存或冒险角色操作，观战账号不能整理被观战者的物品。";
            case "player_unavailable"->"角色离线、死亡或倒地，恢复正常状态后再操作。";
            case "save_unverified"->"前次存盘结果尚未确认，自动整理暂停；联系服主核对原请求，勿重放。";
            case "stash_trade_pending"->"有交易正在对账，先核对交易结果，再整理个人箱。";
            case "settings_save_unverified"->"自动整理设置尚未确认保存，当前内存设置已恢复；联系服主核对存档。";
            default->"参数有误，先按帮助中的完整命令操作。";
        };
        p.sendMessage("§e["+reason+"] 本次未整理；"+hint+"查询："+next);reply(p,out);
    }
    private void reply(Player p,JsonObject out){p.sendMessage("MC_INVENTORY_TIDY "+out);if(operator!=null)operator.sendMessage("MC_INVENTORY_TIDY "+out);}
}
