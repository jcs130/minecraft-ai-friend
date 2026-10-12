package dev.qiandeng.maw;

import com.google.gson.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.item.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/** Vanilla chest menus for Java, Bedrock and native menu clients; no client mod required. */
final class WandscapeMenus {
    private static JsonObject args(String key, String value) { JsonObject a = new JsonObject(); a.addProperty(key, value); return a; }
    private static JsonObject call(ServerPlayer p, String kind, JsonObject a, boolean read) {
        JsonObject result = NativeModAccess.invokeMenuChild(p, "wandscape." + kind, a, read, "town-ui-" + UUID.randomUUID());
        if (!result.has("ok") || !result.get("ok").getAsBoolean()) {
            JsonObject state = result.has("state") ? result.getAsJsonObject("state") : new JsonObject();
            throw new IllegalArgumentException(state.has("reason") ? state.get("reason").getAsString() : result.has("code") ? result.get("code").getAsString() : "wandscape_request_failed");
        }
        JsonObject state=result.getAsJsonObject("state");
        if(state.has("applied")&&!state.get("applied").getAsBoolean())
            throw new IllegalArgumentException(state.has("reason")?state.get("reason").getAsString():"原生操作未生效，请检查资源、空间和前置条件。");
        return state;
    }
    private static JsonObject state(ServerPlayer p) { return call(p, "state", new JsonObject(), true); }
    private static Item icon(String id) { return BuiltInRegistries.ITEM.get(ResourceLocation.parse(id)); }
    private static String pos(JsonObject v) { return v.get("x") + ", " + v.get("y") + ", " + v.get("z"); }
    private static void add(SimpleContainer c, Map<Integer,Consumer<ServerPlayer>> buttons, int slot, Item item, String name, Consumer<ServerPlayer> action, String... lore) {
        RpgMigrationBridge.add(c, buttons, slot, item, name, action, lore);
    }
    private static void show(ServerPlayer p, String title, SimpleContainer c, Map<Integer,Consumer<ServerPlayer>> buttons) {
        add(c, buttons, 26, Items.COMPASS, "返回魔法小镇", WandscapeMenus::open);
        RpgMigrationBridge.show(p, title, c, buttons);
    }
    static void open(ServerPlayer p) {
        JsonObject s = state(p); SimpleContainer c = new SimpleContainer(27); Map<Integer,Consumer<ServerPlayer>> b = new HashMap<>();
        boolean founded = !s.get("colonyId").isJsonNull();
        add(c, b, 4, Items.BOOK, founded ? s.get("name").getAsString() + " · Lv" + s.get("level") : "建立自己的魔法小镇", q->{},
                "Wandscape 原生法师施工、材料仓储与小镇成长", "每名创始人一个小镇；只操作自己的居民和仓库");
        if (!founded) {
            add(c, b, 11, Items.BELL, "在脚下选址建立市政厅", q -> preview(q, null, q.blockPosition(), 0), "先看占地再确认；不自动清空地形", "初始法师与首建规则沿用模组");
        } else {
            add(c, b, 9, Items.BRICKS, "建筑蓝图", q->catalog(q, 0), "在预定建筑锚点站好后选择蓝图");
            add(c, b, 11, Items.BLAZE_ROD, "法师与战斗策略 · " + s.get("mageCount"), q->mages(q, 0), "真实法师状态；四种原生策略");
            add(c, b, 13, Items.CHEST, "小镇仓储", q->warehouse(q, 0), "须在自己已完工的市政厅8格内", "保留物品完整组件；不会存走绑定道具");
            add(c, b, 15, Items.EMERALD, "酒馆招募", q->{JsonObject current=state(q);JsonObject tavern=nearBuilding(q,current,"tavern");JsonObject a=new JsonObject();a.add("position",tavern.get("position"));call(q,"recruit",a,false);open(q);}, "须在自己已完工的酒馆8格内", "沿用原生元素费用；资源不足时拒绝");
            add(c, b, 18, Items.PAPER, "建筑施工进度 · " + s.get("buildingCount"), q->buildings(q, 0));
            add(c, b, 20, Items.AMETHYST_SHARD, "元素仓储", q->{}, s.get("elements").toString(), "小镇经验 " + s.get("xp") + " / " + s.get("requiredXp"));
        }
        add(c, b, 24, Items.ARROW, "返回命格书", q->RpgMigrationBridge.open(q,"guide",1));
        RpgMigrationBridge.show(p, "魔法小镇 · 我的领地", c, b);
    }
    private static JsonObject nearBuilding(ServerPlayer p, JsonObject s, String category) {
        for (JsonElement v : s.getAsJsonArray("buildings")) {
            JsonObject r=v.getAsJsonObject(), at=r.getAsJsonObject("position");
            BlockPos pos=new BlockPos(at.get("x").getAsInt(),at.get("y").getAsInt(),at.get("z").getAsInt());
            if (category.equals(r.get("category").getAsString()) && r.get("intact").getAsBoolean() && pos.distSqr(p.blockPosition())<=64) return r;
        }
        throw new IllegalArgumentException("请先走到自己已完工的" + (category.equals("tavern") ? "酒馆" : "市政厅") + "锚点8格内。");
    }
    private static void catalog(ServerPlayer p, int offset) {
        JsonObject a=new JsonObject();a.addProperty("offset",offset);a.addProperty("limit",18);JsonObject s=call(p,"catalog",a,true);
        SimpleContainer c=new SimpleContainer(27);Map<Integer,Consumer<ServerPlayer>> b=new HashMap<>();int n=0;
        for(JsonElement v:s.getAsJsonArray("buildings")){JsonObject r=v.getAsJsonObject();if(r.get("category").getAsString().equals("government"))continue;
            boolean unlocked=r.get("unlocked").getAsBoolean();add(c,b,n++,unlocked?Items.BRICKS:Items.BARRIER,r.get("name").getAsString(),q->{if(!unlocked)throw new IllegalArgumentException("该蓝图尚未解锁。");preview(q,r,q.blockPosition(),0);},
                    r.get("id").getAsString(),unlocked?"点击查看脚下选址与确认施工":"需要提升小镇等级或满足原生前置", "首建可免费="+r.get("firstFree"));}
        if(offset>0)add(c,b,23,Items.ARROW,"上一页",q->catalog(q,Math.max(0,offset-18)));
        if(!s.get("nextOffset").isJsonNull())add(c,b,24,Items.ARROW,"下一页",q->catalog(q,s.get("nextOffset").getAsInt()));
        show(p,"小镇建筑蓝图 · "+(offset/18+1),c,b);
    }
    private static void preview(ServerPlayer p, JsonObject blueprint, BlockPos anchor, int rotation) {
        if(blueprint==null){JsonObject a=new JsonObject();a.addProperty("offset",0);a.addProperty("limit",24);int offset=0;
            do{a.addProperty("offset",offset);JsonObject page=call(p,"catalog",a,true);for(JsonElement v:page.getAsJsonArray("buildings"))if(v.getAsJsonObject().get("category").getAsString().equals("government")){blueprint=v.getAsJsonObject();break;}if(blueprint!=null||page.get("nextOffset").isJsonNull())break;offset=page.get("nextOffset").getAsInt();}while(offset<10000);
            if(blueprint==null)throw new IllegalArgumentException("市政厅蓝图未加载。");}
        JsonObject selected=blueprint;boolean founding=selected.get("category").getAsString().equals("government");
        SimpleContainer c=new SimpleContainer(27);Map<Integer,Consumer<ServerPlayer>> b=new HashMap<>();AtomicBoolean used=new AtomicBoolean();
        JsonObject footprint=selected.getAsJsonObject("footprint");
        add(c,b,4,Items.PAPER,selected.get("name").getAsString(),q->{},"锚点 "+anchor.toShortString()+" · 旋转 "+rotation*90+"°", "未旋转占地偏移 "+pos(footprint.getAsJsonObject("minOffset"))+" 至 "+pos(footprint.getAsJsonObject("maxOffset")),"不清空整个区域；法师按原生任务逐块施工");
        add(c,b,11,Items.LIME_WOOL,"确认在此施工",q->{if(!used.compareAndSet(false,true))return;q.closeContainer();JsonObject a=new JsonObject();a.add("position",ModRequest.position(anchor));a.addProperty("rotationSteps",rotation);
            if(founding)a.addProperty("name",q.getGameProfile().getName()+"的魔法小镇");else a.addProperty("typeId",selected.get("id").getAsString());
            JsonObject result=call(q,founding?"found":"build",a,false);RpgMigrationBridge.hint(q,result.has("alreadyFounded")?"你已拥有小镇。":"施工任务已入队，建筑尚未完工；可在小镇菜单查看进度。");open(q);},"再次核对本人权限、区块加载与蓝图解锁","重复点击不会重复施工；材料按原生规则扣除");
        add(c,b,13,Items.COMPASS,"旋转90°",q->preview(q,selected,anchor,(rotation+1)%4));
        add(c,b,15,Items.BARRIER,"取消",WandscapeMenus::open);
        show(p,"确认小镇选址与施工",c,b);
    }
    private static void buildings(ServerPlayer p,int offset){JsonObject s=state(p);JsonArray rows=s.getAsJsonArray("buildings");SimpleContainer c=new SimpleContainer(27);Map<Integer,Consumer<ServerPlayer>> b=new HashMap<>();
        for(int i=offset;i<Math.min(rows.size(),offset+18);i++){JsonObject r=rows.get(i).getAsJsonObject();add(c,b,i-offset,Items.BRICKS,r.get("name").getAsString(),q->buildings(q,offset),"锚点 "+pos(r.getAsJsonObject("position")),r.get("intact").getAsBoolean()?"建筑已完工":"施工中 · 待办 "+r.get("queuedTasks"));}pages(c,b,rows.size(),offset,q->buildings(q,Math.max(0,offset-18)),q->buildings(q,offset+18));show(p,"小镇建筑 · 点击刷新",c,b);}
    private static void mages(ServerPlayer p,int offset){JsonArray rows=state(p).getAsJsonArray("mages");SimpleContainer c=new SimpleContainer(27);Map<Integer,Consumer<ServerPlayer>> b=new HashMap<>();
        for(int i=offset;i<Math.min(rows.size(),offset+18);i++){JsonObject r=rows.get(i).getAsJsonObject();add(c,b,i-offset,Items.BLAZE_ROD,r.get("name").getAsString()+" · Lv"+r.get("level"),q->strategy(q,r),"魔力 "+r.get("mana")+" · "+r.get("preset").getAsString(),r.has("position")?"坐标 "+pos(r.getAsJsonObject("position")):"实体未加载","点击设置原生施法策略");}pages(c,b,rows.size(),offset,q->mages(q,Math.max(0,offset-18)),q->mages(q,offset+18));show(p,"我的小镇法师",c,b);}
    private static void strategy(ServerPlayer p,JsonObject mage){SimpleContainer c=new SimpleContainer(27);Map<Integer,Consumer<ServerPlayer>> b=new HashMap<>();String[] ids={"BALANCED","OFFENSIVE","SUPPORT","DEFENSIVE"},names={"均衡","进攻","支援","防御"};for(int i=0;i<4;i++){String id=ids[i];add(c,b,10+i,Items.BLAZE_POWDER,names[i],q->{JsonObject a=args("npcUuid",mage.get("uuid").getAsString());a.addProperty("preset",id);call(q,"strategy",a,false);mages(q,0);},"保留该法师已学法术；不凭空解锁技能");}show(p,"法师策略 · "+mage.get("name").getAsString(),c,b);}
    private static void pages(SimpleContainer c,Map<Integer,Consumer<ServerPlayer>> b,int count,int offset,Consumer<ServerPlayer> prev,Consumer<ServerPlayer> next){if(offset>0)add(c,b,23,Items.ARROW,"上一页",prev);if(offset+18<count)add(c,b,24,Items.ARROW,"下一页",next);}
    private static void warehouse(ServerPlayer p,int offset){JsonObject s=state(p);JsonObject hall=nearBuilding(p,s,"government");JsonArray rows=s.getAsJsonArray("warehouse");SimpleContainer c=new SimpleContainer(27);Map<Integer,Consumer<ServerPlayer>> b=new HashMap<>();
        for(int i=offset;i<Math.min(rows.size(),offset+18);i++){JsonObject r=rows.get(i).getAsJsonObject();add(c,b,i-offset,icon(r.get("itemId").getAsString()),r.get("name").getAsString()+" ×"+r.get("count"),q->{if(r.get("itemSnbt").isJsonNull())throw new IllegalArgumentException("完整组件过大；请使用原生Java仓库界面。");JsonObject a=new JsonObject();a.add("position",hall.get("position"));a.add("itemSnbt",r.get("itemSnbt"));a.add("expectedAvailable",r.get("count"));a.addProperty("quantity",Math.min(64,r.get("count").getAsInt()));JsonObject moved=call(q,"withdraw",a,false);RpgMigrationBridge.hint(q,"已取出 "+moved.get("movedCount")+" 件。");warehouse(q,offset);},"点击最多取64件；满包不丢物品","展示图标不可取走；这是小镇真实仓储记录");}
        add(c,b,20,Items.HOPPER,"从背包存入材料",q->deposit(q,0),"仓储 "+s.get("storageUsed")+" / "+s.get("storageCapacity"));pages(c,b,rows.size(),offset,q->warehouse(q,Math.max(0,offset-18)),q->warehouse(q,offset+18));show(p,"小镇仓储 · 点击取出",c,b);}
    private static void deposit(ServerPlayer p,int offset){JsonObject hall=nearBuilding(p,state(p),"government");SimpleContainer c=new SimpleContainer(27);Map<Integer,Consumer<ServerPlayer>> b=new HashMap<>();for(int i=offset;i<Math.min(36,offset+18);i++){ItemStack stack=p.getInventory().getItem(i);if(stack.isEmpty()||RpgStorage.bound(stack))continue;int slot=i;String expected=ModRequest.snbt(p,stack);int count=stack.getCount();add(c,b,i-offset,stack.getItem(),stack.getHoverName().getString()+" ×"+count,q->{JsonObject a=new JsonObject();a.add("position",hall.get("position"));a.addProperty("inventorySlot",slot);a.addProperty("expectedSnbt",expected);a.addProperty("quantity",count);call(q,"deposit",a,false);deposit(q,offset);},"点击存入此堆；成交时核对完整组件和数量");}pages(c,b,36,offset,q->deposit(q,Math.max(0,offset-18)),q->deposit(q,offset+18));show(p,"存入小镇仓储 · 本人背包",c,b);}
}
