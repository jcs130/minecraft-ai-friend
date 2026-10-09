package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.inventory.*;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;

/** Owner and administrator membership; GUI and CLI share the same durable mutation. */
final class LandAccess implements Listener {
    private final AgentFriendPlugin plugin;
    private final LandManager lands;
    private final LandNoticeBoards boards;
    private final NamespacedKey introduced;
    private final Map<Inventory, View> views = new IdentityHashMap<>();
    private record View(UUID viewer, String land, String mode, int page, List<UUID> targets, UUID target) { }
    LandAccess(AgentFriendPlugin plugin, LandManager lands) {
        this.plugin=plugin; this.lands=lands; introduced=new NamespacedKey(plugin,"land_access_intro_v1");
        boards=new LandNoticeBoards(plugin,lands,this);
        Bukkit.getPluginManager().registerEvents(this,plugin);
    }
    void stop() { views.clear(); }
    boolean isBoard(org.bukkit.block.Block b) { return boards.isBoard(b); }
    boolean protectsBoard(org.bukkit.block.Block b) { return boards.protects(b); }
    void auditBoards(org.bukkit.command.CommandSender sender) { boards.audit(sender); }
    void refreshBoards() { try { boards.refresh(); } catch (RuntimeException e) { plugin.getLogger().warning("Land boards deferred: "+e); } }
    private String name(UUID id) { String n=Bukkit.getOfflinePlayer(id).getName(); return n==null?id.toString():n; }
    private boolean manager(Player p, LandManager.Land land) {
        return land!=null&&(plugin.isLandAdministrator(p)||!plugin.isObserver(p)&&land.owner().equals(p.getUniqueId()));
    }
    void hint(Player p, LandManager.Land land) {
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("landId",land.id());
        out.addProperty("membersCommand","/mycli land members "+land.id());out.addProperty("boardCommand","/mycli land board "+land.id());
        out.addProperty("canManageMembers",manager(p,land));
        out.addProperty("administrator",plugin.isLandAdministrator(p));
        if(manager(p,land)) {
            out.addProperty("trustCommand","/mycli land trust "+land.id()+" <玩家名或UUID>");
            out.addProperty("untrustCommand","/mycli land untrust "+land.id()+" <玩家名或UUID>");
            p.sendMessage("§a你是"+(plugin.isLandAdministrator(p)?"领地超管":"领地主人")+"：/mycli land trust "+land.id()+" <玩家名或UUID> 授权；untrust 撤权。成员可拆建并取放私有箱，不能继续授权；原公共建筑保护仍适用。");
        }
        lands.machine(p,"MC_LAND_GUIDE",out);
    }
    @EventHandler public void joined(PlayerJoinEvent e) {
        Player p=e.getPlayer();Bukkit.getScheduler().runTaskLater(plugin,()->{
            if(!p.isOnline()||plugin.isObserver(p)&&!plugin.isLandAdministrator(p)||p.getPersistentDataContainer().has(introduced,PersistentDataType.BYTE))return;
            LandManager.Land own=lands.definitions().stream().filter(l->manager(p,l)).findFirst().orElse(null);
            if(own!=null){hint(p,own);p.getPersistentDataContainer().set(introduced,PersistentDataType.BYTE,(byte)1);}
        },60L);
    }
    private OfflinePlayer resolve(String raw, LandManager.Land land, boolean adding) {
        try {
            UUID id=UUID.fromString(raw);
            if(!id.toString().equalsIgnoreCase(raw)||id.equals(new UUID(0,0)))return null;
            OfflinePlayer p=Bukkit.getOfflinePlayer(id);
            return !adding&&land.members().contains(id)||p.isOnline()||p.hasPlayedBefore()?p:null;
        } catch(IllegalArgumentException ignored) { }
        if(raw.length()>32||raw.chars().anyMatch(c->c<=32||c==167))return null;
        Player online=Bukkit.getPlayerExact(raw);if(online!=null)return online;
        OfflinePlayer cached=Bukkit.getOfflinePlayerIfCached(raw);
        if(cached!=null&&cached.getName()!=null&&cached.getName().equalsIgnoreCase(raw)&&cached.hasPlayedBefore())return cached;
        if(!adding)for(UUID id:land.members())if(name(id).equalsIgnoreCase(raw))return Bukkit.getOfflinePlayer(id);
        return null;
    }
    private JsonObject result(Player p,String action,String id,UUID target,String reason) {
        boolean changed=reason.equals("member_added")||reason.equals("member_removed");
        boolean unchanged=reason.equals("already_member")||reason.equals("not_member");
        String next=switch(reason) {
            case "member_added" -> "授权已生效：该成员可在这块领地拆建和取放私有物品；没有转授权或转让权。";
            case "member_removed" -> "撤权已生效，已关闭对方失去权限的私有箱；后续操作重新校验。";
            case "already_member" -> "对方已是成员，没有重复写入；用 members 复查名单。";
            case "not_member" -> "对方不在成员名单中，无须重复撤权。";
            case "not_land_owner" -> "只有当前领地主人或领地超管能授权或撤权；先 land info 核对主人，再通过游戏内交流申请。成员和普通 OP 不能代授权。";
            case "observer_cannot_manage","observer_target" -> "普通观战者不能管理或接受施工授权；使用本人实际游玩的角色。女神等领地超管可在观战时管理名单。";
            case "unknown_player" -> "玩家身份未核实；请对方先登录一次，再用完整账号名或已核实 UUID。不能按显示名或皮肤名猜测。";
            case "target_is_owner" -> "主人已有权限，不能用成员撤权移除主人；转让须联系服主管理。";
            case "member_limit_reached" -> "每块领地最多64位协作者；先 members 查名单，再撤销不需要的成员。";
            case "change_rate_limited" -> "领地名单刚修改过；至少等1秒，先 members 确认结果后再执行下一次修改。";
            case "land_config_pending_reload" -> "管理员配置有待加载修改；请服主检查并执行 mycli admin land reload 成功后重试。本次没有覆盖配置。";
            case "invalid_arguments" -> "用 /mycli land trust|untrust <领地ID> <完整玩家名或UUID>；members <领地ID> [页码] 查名单。";
            default -> "本次未确认修改成功，请停止重复操作，用 land info/members 核查并联系服主检查领地数据。";
        };
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("action",action);out.addProperty("landId",id);
        out.addProperty("actorUuid",p.getUniqueId().toString());LandManager.Land actual=lands.definition(id);
        out.addProperty("authority",plugin.isLandAdministrator(p)?"administrator":actual!=null&&actual.owner().equals(p.getUniqueId())?"owner":"visitor");
        out.addProperty("status",changed?"success":unchanged?"unchanged":"denied");out.addProperty("reason",reason);out.addProperty("changed",changed);
        if(target!=null){out.addProperty("targetUuid",target.toString());out.addProperty("targetName",name(target));}
        out.addProperty("nextAction",next);out.addProperty("membersCommand","/mycli land members "+id);
        p.sendMessage((changed||unchanged?"§a":"§c")+next);lands.machine(p,"MC_LAND_MEMBER_RESULT",out);return out;
    }
    private JsonObject mutate(Player p,String action,String id,String raw) {
        LandManager.Land land=lands.definition(id);
        if(land==null)return result(p,action,id,null,"land_unavailable");
        if(plugin.isObserver(p)&&!plugin.isLandAdministrator(p))return result(p,action,id,null,"observer_cannot_manage");
        if(!manager(p,land))return result(p,action,id,null,"not_land_owner");
        boolean add=action.equals("trust");OfflinePlayer target=resolve(raw,land,add);
        if(target==null)return result(p,action,id,null,"unknown_player");
        if(add&&target.isOnline()&&plugin.isObserver(target.getPlayer()))return result(p,action,id,target.getUniqueId(),"observer_target");
        return result(p,action,id,target.getUniqueId(),lands.changeMember(p,id,target.getUniqueId(),add));
    }
    // Console-only MCP adapter. No arbitrary actor, command or file is accepted.
    boolean adminCommand(org.bukkit.command.CommandSender sender,String[] args) {
        if(args.length<3||!Set.of("member","members").contains(args[2].toLowerCase(Locale.ROOT)))return false;
        if(args.length==4&&args[2].equalsIgnoreCase("members")) {
            LandManager.Land land=lands.definition(args[3]);JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("landId",args[3]);
            if(land==null){out.addProperty("status","denied");out.addProperty("reason","land_unavailable");}
            else {out.addProperty("status","success");out.addProperty("owner",name(land.owner()));out.addProperty("ownerUuid",land.owner().toString());JsonArray all=new JsonArray();for(UUID id:sorted(land)){JsonObject m=new JsonObject();m.addProperty("name",name(id));m.addProperty("uuid",id.toString());all.add(m);}out.add("members",all);}
            sender.sendMessage("MC_LAND_MEMBERS "+out);return true;
        }
        if(args.length!=6||!args[2].equalsIgnoreCase("member")||!Set.of("trust","untrust").contains(args[3].toLowerCase(Locale.ROOT))) {
            sender.sendMessage("mycli admin land members <ID>；member trust|untrust <ID> <完整玩家名或UUID> 通过在线女神管理。");return true;
        }
        Player goddess=plugin.goddessLandAdministrator();
        if(goddess==null){JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("status","denied");out.addProperty("reason","goddess_unavailable");out.addProperty("changed",false);out.addProperty("nextAction","先恢复已核实的女神 OP 观战账号；本次未修改。超时先读取原领地名单，不要盲目重试。");sender.sendMessage("MC_LAND_MEMBER_RESULT "+out);}
        else sender.sendMessage("MC_LAND_MEMBER_RESULT "+mutate(goddess,args[3].toLowerCase(Locale.ROOT),args[4],args[5]));
        return true;
    }
    boolean command(Player p,String[] args) {
        if(args.length<2)return false;String action=args[1].toLowerCase(Locale.ROOT);
        if(!Set.of("trust","untrust","members","manage","board").contains(action))return false;
        String id=args.length>2?args[2]:"";
        if(action.equals("trust")||action.equals("untrust")) {
            if(args.length!=4){result(p,action,id,null,"invalid_arguments");return true;}mutate(p,action,id,args[3]);return true;
        }
        if(args.length<3||args.length>(action.equals("members")?4:3)){result(p,action,id,null,"invalid_arguments");return true;}
        LandManager.Land land=lands.definition(id);if(land==null){result(p,action,id,null,"land_unavailable");return true;}
        if(action.equals("manage")){if(manager(p,land))open(p,id,"members",1,null);else result(p,action,id,null,"not_land_owner");return true;}
        if(action.equals("board")){boards.info(p,id);return true;}
        int page=1;try{if(args.length==4)page=Integer.parseInt(args[3]);}catch(NumberFormatException invalid){result(p,action,id,null,"invalid_arguments");return true;}
        members(p,land,page);return true;
    }
    private List<UUID> sorted(LandManager.Land l) { return l.members().stream().sorted(Comparator.comparing(this::name,String.CASE_INSENSITIVE_ORDER).thenComparing(UUID::toString)).toList(); }
    private void members(Player p,LandManager.Land land,int requested) {
        List<UUID> ids=sorted(land);int pages=Math.max(1,(ids.size()+8)/9),page=Math.max(1,Math.min(pages,requested));
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("landId",land.id());out.addProperty("owner",name(land.owner()));out.addProperty("ownerUuid",land.owner().toString());
        out.addProperty("count",ids.size());out.addProperty("page",page);out.addProperty("pages",pages);out.addProperty("canManageMembers",manager(p,land));out.addProperty("administrator",plugin.isLandAdministrator(p));
        out.addProperty("scope","成员可拆建并取放私有物品；不能继续授权或转让；原公共建筑保护仍适用");lands.machine(p,"MC_LAND_MEMBERS",out);
        for(UUID id:ids.subList((page-1)*9,Math.min(page*9,ids.size()))){JsonObject m=new JsonObject();m.addProperty("landId",land.id());m.addProperty("name",name(id));m.addProperty("uuid",id.toString());lands.machine(p,"MC_LAND_MEMBER",m);}
        if(page<pages)p.sendMessage("下一页：/mycli land members "+land.id()+" "+(page+1));
    }
    private ItemStack icon(Material type,String label,String... lore) { ItemStack i=new ItemStack(type);ItemMeta m=i.getItemMeta();m.setDisplayName(label);m.setLore(List.of(lore));i.setItemMeta(m);return i; }
    void openPublic(Player p,String id) { open(p,id,"members",1,null); }
    private void open(Player p,String id,String mode,int requested,UUID target) {
        LandManager.Land land=lands.definition(id);if(land==null)return;
        boolean own=manager(p,land);if(!mode.equals("members")&&!own){result(p,mode,id,null,"not_land_owner");return;}
        List<UUID> targets=mode.equals("trust")?Bukkit.getOnlinePlayers().stream().filter(x->!plugin.isObserver(x)&&!x.getUniqueId().equals(land.owner())&&!land.members().contains(x.getUniqueId())).map(Player::getUniqueId).sorted(Comparator.comparing(this::name)).toList():sorted(land);
        int pages=Math.max(1,(targets.size()+8)/9),page=Math.max(1,Math.min(pages,requested));Inventory inv=Bukkit.createInventory(null,27,"领地公告 · "+(mode.startsWith("confirm")?"确认操作":"第 "+page+" 页"));
        inv.setItem(4,icon(Material.OAK_SIGN,"§6"+land.title(),"§7主人："+name(land.owner()),"§7协作者："+land.members().size()+" 人", "§7范围含边界："+land.min()+" 至 "+land.max()));
        if(mode.startsWith("confirm")) {
            inv.setItem(13,icon(Material.PAPER,"§e"+name(target),"§7"+target,"§7仅影响这块领地；不转让主人",mode.equals("confirm_trust")?"§c将允许拆建、私有箱取放":"§c将移除施工与私有物品权限"));
            inv.setItem(15,icon(Material.LIME_DYE,"§a确认"));inv.setItem(11,icon(Material.ARROW,"返回名单"));
        } else {
            targets=targets.subList((page-1)*9,Math.min(page*9,targets.size()));
            for(int i=0;i<targets.size();i++)inv.setItem(9+i,icon(Material.PAPER,"§f"+name(targets.get(i)),"§7"+targets.get(i),mode.equals("trust")?"§a点击查看授权范围并确认":own?"§e点击确认撤权":"§7协作者；主人或超管可修改"));
            if(targets.isEmpty())inv.setItem(13,icon(Material.PAPER,mode.equals("trust")?"暂无可授权的在线玩家":"暂无协作者","§7离线授权可用已登录过的完整账号名/UUID"));
            if(page>1)inv.setItem(18,icon(Material.ARROW,"上一页"));if(page<pages)inv.setItem(25,icon(Material.ARROW,"下一页"));
            if(own)inv.setItem(20,icon(Material.LIME_DYE,"§a授权玩家","§7选择在线旅人；下一页确认范围"));
            if(mode.equals("trust"))inv.setItem(22,icon(Material.ARROW,"返回协作者名单"));
        }
        inv.setItem(26,icon(Material.BARRIER,"关闭"));views.put(inv,new View(p.getUniqueId(),id,mode,page,List.copyOf(targets),target));p.openInventory(inv);
    }
    @EventHandler(priority=EventPriority.HIGHEST) public void click(InventoryClickEvent e) {
        View v=views.get(e.getView().getTopInventory());if(v==null)return;e.setCancelled(true);
        if(!(e.getWhoClicked() instanceof Player p)||!v.viewer().equals(p.getUniqueId())||e.getRawSlot()<0||e.getRawSlot()>=27||e.getClick().isShiftClick())return;
        int slot=e.getRawSlot();p.closeInventory();Bukkit.getScheduler().runTask(plugin,()->{
            if(!p.isOnline())return;
            if(v.mode().startsWith("confirm")) {
                if(slot==15){mutate(p,v.mode().equals("confirm_trust")?"trust":"untrust",v.land(),v.target().toString());openPublic(p,v.land());}
                else if(slot==11)openPublic(p,v.land());return;
            }
            if(slot==20)open(p,v.land(),"trust",1,null);
            else if(slot==22)openPublic(p,v.land());
            else if(slot==18||slot==25)open(p,v.land(),v.mode(),v.page()+(slot==18?-1:1),null);
            else if(slot>=9&&slot<9+v.targets().size())open(p,v.land(),v.mode().equals("trust")?"confirm_trust":"confirm_untrust",1,v.targets().get(slot-9));
        });
    }
    @EventHandler(priority=EventPriority.HIGHEST) public void drag(InventoryDragEvent e) { if(views.containsKey(e.getView().getTopInventory()))e.setCancelled(true); }
    @EventHandler public void close(InventoryCloseEvent e) { views.remove(e.getInventory()); }
}
