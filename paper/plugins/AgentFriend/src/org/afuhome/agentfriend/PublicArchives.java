package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import org.bukkit.*;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.*;
import org.bukkit.inventory.*;
import org.bukkit.inventory.meta.BookMeta;
import org.bukkit.persistence.PersistentDataType;

/** Public books use the ordinary written_book protocol. SQLite holds originals and
 * editions independently of inventories. All disk/image work uses one bounded worker.
 * A print retry is never treated as permission to mint a second physical item. */
final class PublicArchives implements Listener {
    private final AgentFriendPlugin plugin;
    private final NamespacedKey entryKey,versionKey,copyKey;
    private final ThreadPoolExecutor io;
    private final Map<Inventory,Menu> menus=new IdentityHashMap<>();
    private final Set<String> desks=new HashSet<>();
    private final Set<UUID> writing=new HashSet<>();
    private ArchiveStore store; // Only touched by the I/O worker.
    private volatile boolean ready;
    private volatile String problem="starting";
    private boolean closing;
    private final java.util.concurrent.atomic.AtomicBoolean sourceQueued=new java.util.concurrent.atomic.AtomicBoolean();
    private record Menu(UUID reader,int page,String kind,List<ArchiveStore.Entry> entries) { }
    private record Query(String action,List<String> arguments,boolean json,int page,String request,int version) { }
    private record Source(String author,String name,String request,String id,String kind,String title,String body,String metadata,boolean published,long at) { }
    private record Print(ArchiveStore.Entry entry,String copy,boolean first) { }
    private interface Work<T>{T run()throws Exception;}
    private static boolean inSession(Player p){return p.isOnline()&&Bukkit.getPlayer(p.getUniqueId())==p;}

    PublicArchives(AgentFriendPlugin plugin){
        this.plugin=plugin;entryKey=new NamespacedKey(plugin,"archive_entry");
        versionKey=new NamespacedKey(plugin,"archive_version");copyKey=new NamespacedKey(plugin,"archive_copy");
        io=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(64),r->{Thread t=new Thread(r,"AgentFriend-archives");t.setDaemon(true);return t;});
        io.execute(()->{try{store=new ArchiveStore(plugin.getDataFolder().toPath().resolve("archives/archive.db"));ready=true;problem="";}
            catch(Exception e){problem=e.getClass().getSimpleName();plugin.getLogger().severe("Public archive unavailable; originals retained: "+problem);}});
        Path settings=plugin.getDataFolder().toPath().resolve("public-archives.yml");
        if(!Files.exists(settings))plugin.saveResource("public-archives.yml",false);
        var config=YamlConfiguration.loadConfiguration(settings.toFile());
        for(Map<?,?> desk:config.getMapList("desks"))if(desk.get("world") instanceof String world&&desk.get("x") instanceof Number x&&desk.get("y") instanceof Number y&&desk.get("z") instanceof Number z)desks.add(world+":"+x.intValue()+":"+y.intValue()+":"+z.intValue());
        Bukkit.getPluginManager().registerEvents(this,plugin);
        Bukkit.getScheduler().runTaskTimer(plugin,this::syncSources,100L,1200L);
    }

    private <T> void work(Player p,Query q,Work<T> work,Consumer<T> done){
        boolean isWrite=Set.of("create","notice","restore").contains(q.action);
        if(!ready||closing){if(isWrite)writing.remove(p.getUniqueId());error(p,q.json,"ARCHIVE_UNAVAILABLE","档案库尚未就绪；没有扣物。稍后用 archive status 核对。",false);return;}
        try{io.execute(()->{
            try{T value=work.run();main(()->{if(inSession(p))done.accept(value);else if(isWrite)writing.remove(p.getUniqueId());});}
            catch(IllegalArgumentException e){main(()->{if(isWrite)writing.remove(p.getUniqueId());if(inSession(p))error(p,q.json,"INVALID_ARGUMENT",e.getMessage()+"；先查 archive list 核对作品。",false);});}
            catch(Exception e){plugin.getLogger().warning("Archive operation retained for investigation: "+e.getClass().getSimpleName());
                main(()->{if(isWrite)writing.remove(p.getUniqueId());if(inSession(p))error(p,q.json,"ARCHIVE_SAVE_UNKNOWN","档案操作未确认；先查 archive list，不要重复消耗性操作。",false);});}
        });}catch(RejectedExecutionException e){if(isWrite)writing.remove(p.getUniqueId());error(p,q.json,"ARCHIVE_BUSY","档案库正在处理其他作品；没有扣物，稍后查 archive status。",true);}
    }
    private void main(Runnable action){if(!closing&&plugin.isEnabled())Bukkit.getScheduler().runTask(plugin,action);}

    private static Query parse(String[] raw){
        List<String> args=new ArrayList<>();boolean json=false;int page=1,version=0;String request=UUID.randomUUID().toString();
        Set<String> options=new HashSet<>();boolean literal=false;
        for(int n=1;n<raw.length;n++){
        if(literal){args.add(raw[n]);continue;}if(raw[n].equals("--")){literal=true;continue;}
        if(raw[n].startsWith("--")&&!options.add(raw[n]))throw new IllegalArgumentException("选项不能重复："+raw[n]);
        switch(raw[n]){
            case "--json" -> json=true;
            case "--page" -> {if(++n==raw.length)throw new IllegalArgumentException("--page 后需页码");page=Integer.parseInt(raw[n]);}
            case "--version" -> {if(++n==raw.length)throw new IllegalArgumentException("--version 后需版本号");version=Integer.parseInt(raw[n]);}
            case "--request-id" -> {if(++n==raw.length)throw new IllegalArgumentException("--request-id 后需稳定请求标识");request=raw[n];}
            default -> {if(raw[n].startsWith("--"))throw new IllegalArgumentException("未知选项 "+raw[n]);args.add(raw[n]);}
        }}
        if(page<1||page>10000||version<0||!request.matches("[A-Za-z0-9_.:-]{1,100}"))throw new IllegalArgumentException("页码、版本或请求标识无效");
        String action=args.isEmpty()?"status":args.removeFirst().toLowerCase(Locale.ROOT);
        if(options.contains("--page")&&!Set.of("list","menu","read").contains(action))throw new IllegalArgumentException("--page 仅用于list、menu或read");
        if(options.contains("--version")&&!Set.of("info","read","restore").contains(action))throw new IllegalArgumentException("--version 仅用于info、read或restore");
        if(options.contains("--request-id")&&!Set.of("create","notice","restore").contains(action))throw new IllegalArgumentException("--request-id 仅用于create、notice或restore");
        return new Query(action,args,json,page,request,version);
    }
    void command(Player p,String[] args){
        try{
            Query q=parse(args);String action=q.action;
            if(Set.of("status","list","menu").contains(action)){
                if(q.arguments.size()>1||action.equals("status")&&!q.arguments.isEmpty())throw new IllegalArgumentException("用法：archive status 或 archive list/menu [book|photo|notice|event] [--page N]");
                String kind=q.arguments.isEmpty()?"":q.arguments.getFirst();
                if(!kind.isEmpty()&&!Set.of("book","photo","notice","event").contains(kind))throw new IllegalArgumentException("分类用 book、photo、notice 或 event");
                if(action.equals("status")){
                    JsonObject out=base("status",true);out.addProperty("ready",ready);out.addProperty("state",ready?"ready":problem);
                    out.addProperty("publicBooks",true);out.addProperty("nextCommand","/mycli archive list");
                    out.addProperty("advice","日记是公开实体书；create 写新书，read 阅读，restore 用一本空白书与笔恢复副本。委托仍用 commission。");reply(p,q,out,"公共档案馆："+(ready?"可用":"准备中")+"；/mycli archive list 查目录，archive --help 看用法。");return;
                }
                work(p,q,()->store.list(kind,p.getUniqueId().toString(),q.page),rows->{
                    if(action.equals("menu"))open(p,kind,q.page,rows);
                    JsonObject out=base(action,action.equals("list"));out.addProperty("page",q.page);out.addProperty("hasNext",rows.size()==7);
                    JsonArray items=new JsonArray();rows.forEach(e->items.add(summary(e)));out.add("items",items);
                    out.addProperty("nextCommand",rows.size()==7?"/mycli archive "+action+" "+kind+" --page "+(q.page+1):"/mycli archive create --help");
                    reply(p,q,out,action.equals("menu")?"已打开公共档案目录。":"档案第"+q.page+"页："+rows.stream().map(e->e.title()+"（"+e.authorName()+"） "+e.id()).reduce((a,b)->a+"；"+b).orElse("暂无作品；用 archive create 写下第一篇日记。"));
                });return;
            }
            if(action.equals("create")||action.equals("notice")){create(p,q);return;}
            if(!Set.of("info","read","restore").contains(action)||q.arguments.size()!=1)throw new IllegalArgumentException("先用 /mycli archive --help；info/read/restore 后需目录中的作品UUID");
            String id=UUID.fromString(q.arguments.getFirst()).toString();
            if(action.equals("restore")){restore(p,q,id);return;}
            work(p,q,()->visible(id,q.version,p.getUniqueId()),entry->{
                if(entry==null){error(p,q.json,"ARCHIVE_NOT_FOUND","没有可读的该版本作品；先 archive list 核对公开作品ID。",false);return;}
                JsonObject out=summary(entry);out.addProperty("type",action);out.addProperty("readOnly",action.equals("info"));
                out.addProperty("durable",true);out.addProperty("nextCommand","/mycli archive read "+entry.id());
                // Body is available in a vanilla paged book, never one giant chat result.
                out.addProperty("characters",entry.body().length());out.addProperty("bodyCommand","/mycli archive read "+entry.id());
                if(entry.kind().equals("photo")){
                    JsonObject meta=JsonParser.parseString(entry.metadata()).getAsJsonObject();
                    if(meta.has("archiveAssetState"))out.add("assetState",meta.get("archiveAssetState"));
                    out.addProperty("photoCommand",meta.has("source")&&meta.get("source").getAsString().equals("native_imageframe")?"/imageframe list":"/mycli photo info "+entry.id());
                    out.addProperty("physicalPhotos","原地图在作者个人奖励箱；档案库保存原始字节，不自动重复发图或产生考试证明。");
                }
                if(action.equals("read")){
                    List<String> pages=splitText(entry.body(),600);
                    if(q.page>pages.size()){error(p,q.json,"INVALID_PAGE","正文页码范围1–"+pages.size()+"；没有修改作品。",false);return;}
                    out.addProperty("text",pages.get(q.page-1));out.addProperty("page",q.page);out.addProperty("pages",pages.size());
                    out.addProperty("nextCommand",q.page<pages.size()?"/mycli archive read "+entry.id()+" --version "+entry.version()+" --page "+(q.page+1):"/mycli archive info "+entry.id());
                }
                if(action.equals("read"))p.openBook(book(entry,"reading"));
                reply(p,q,out,"《"+entry.title()+"》 · "+entry.authorName()+" · 第"+entry.version()+"版；/mycli archive read "+entry.id()+" 阅读。");
            });
        }catch(IllegalArgumentException e){error(p,Arrays.asList(args).contains("--json"),"INVALID_ARGUMENT",e.getMessage()+"；/mycli archive --help",false);}
    }

    /** Both new diaries and the old life write command share one durable authoring path. */
    void create(Player p,Query q){
        String joined=String.join(" ",q.arguments);int split=joined.indexOf('|');
        if(split<1)throw new IllegalArgumentException("格式：archive create <书名>|<正文> [--request-id 标识]");
        String title=plain(joined.substring(0,split)).trim(),body=plain(joined.substring(split+1)).trim();
        if(title.isEmpty()||title.length()>32||body.isEmpty()||body.length()>10000)throw new IllegalArgumentException("书名1–32字、正文1–10000字；长篇也可用原版书与笔编辑签名");
        if(!beginWriting(p,q))return;int slot=blank(p);
        if(slot<0){writing.remove(p.getUniqueId());error(p,q.json,"MATERIAL_REQUIRED","请在本人背包准备一本空白书与笔；不消耗已写内容或特殊道具。",false);return;}
        ItemStack material=p.getInventory().getItem(slot).clone();String candidate=UUID.randomUUID().toString();
        JsonObject meta=new JsonObject();meta.addProperty("source","server_book_authoring");meta.addProperty("world",p.getWorld().getKey().toString());
        var entry=new ArchiveStore.Entry(candidate,q.action.equals("notice")?"notice":"book",p.getUniqueId().toString(),p.getName(),title,body,meta.toString(),true,System.currentTimeMillis(),1);
        work(p,q,()->store.create(q.request,entry),saved->{
            writing.remove(p.getUniqueId());boolean first=saved.id().equals(candidate);boolean printed=false;
            if(first&&!p.isDead()&&p.getGameMode()!=GameMode.SPECTATOR&&material.equals(p.getInventory().getItem(slot))){
                p.getInventory().setItem(slot,book(saved,"original"));printed=true;
                if(saved.kind().equals("book"))plugin.lifeGuild().written(p,body);
            }
            JsonObject out=summary(saved);out.addProperty("type",q.action);out.addProperty("readOnly",false);out.addProperty("durable",true);out.addProperty("printed",printed);
            out.addProperty("requestId",q.request);out.addProperty("replayed",!first);out.addProperty("nextCommand","/mycli archive info "+saved.id());
            out.addProperty("state",printed?"stored_and_printed":"stored_print_not_confirmed");
            reply(p,q,out,printed?"《"+saved.title()+"》已归档并写成公开实体书，留在原书与笔的位置；可以放进箱子或讲台供大家阅读。":"作品已归档；本次没有再次扣物或打印。请核对背包，缺书可用 archive restore "+saved.id()+" 恢复副本。");
        });
    }
    void legacyWrite(Player p,String title,String body){create(p,new Query("create",List.of(title+"|"+body),false,1,UUID.randomUUID().toString(),0));}
    private boolean beginWriting(Player p,Query q){
        if(!ready||closing){error(p,q.json,"ARCHIVE_UNAVAILABLE","档案库尚未就绪，没有扣物；稍后查 archive status。",true);return false;}
        if(p.isDead()||p.getGameMode()==GameMode.SPECTATOR){error(p,q.json,"ROLE_DENIED","旁观者可阅读公共档案；写书和恢复需使用本人存活的可交互角色。",false);return false;}
        if(!writing.add(p.getUniqueId())){error(p,q.json,"ARCHIVE_BUSY","上一笔写书或恢复尚未确认；先等结果，不要重复操作。",true);return false;}return true;
    }
    private static int blank(Player p){
        ItemStack[] contents=p.getInventory().getStorageContents();
        for(int i=0;i<contents.length;i++)if(contents[i]!=null&&contents[i].getType()==Material.WRITABLE_BOOK&&contents[i].getAmount()==1){
            BookMeta meta=(BookMeta)contents[i].getItemMeta();
            if(!meta.hasPages()&&!meta.hasDisplayName()&&meta.getPersistentDataContainer().isEmpty())return i;
        }return -1;
    }
    private void restore(Player p,Query q,String id){
        if(!beginWriting(p,q))return;int slot=blank(p);
        if(slot<0){writing.remove(p.getUniqueId());error(p,q.json,"MATERIAL_REQUIRED","恢复副本消耗一本空白书与笔；请先放进本人背包。",false);return;}
        ItemStack material=p.getInventory().getItem(slot).clone();String attempt=UUID.randomUUID().toString();
        work(p,q,()->{
            var e=visible(id,q.version,p.getUniqueId());if(e==null)return null;
            if(!Set.of("book","notice").contains(e.kind()))throw new IllegalArgumentException("只有书籍与公告可恢复为实体书；照片请从原个人奖励箱取出");
            String copy=store.copy(e.id(),e.version(),p.getUniqueId().toString(),q.request,attempt);return new Print(e,copy,copy.equals(attempt));
        },print->{
            writing.remove(p.getUniqueId());if(print==null){error(p,q.json,"ARCHIVE_NOT_FOUND","作品不存在或不可读；先 archive list 核对。",false);return;}
            boolean printed=print.first&&!p.isDead()&&p.getGameMode()!=GameMode.SPECTATOR&&material.equals(p.getInventory().getItem(slot));
            if(printed)p.getInventory().setItem(slot,book(print.entry,print.copy));
            JsonObject out=summary(print.entry);out.addProperty("type","restore");out.addProperty("readOnly",false);out.addProperty("copyId",print.copy);out.addProperty("requestId",q.request);
            out.addProperty("durable",true);out.addProperty("printed",printed);out.addProperty("state",printed?"printed":"print_not_confirmed");
            out.addProperty("newAchievement",false);out.addProperty("nextCommand","/mycli archive info "+id);
            reply(p,q,out,printed?"已恢复《"+print.entry.title()+"》的公开副本；原作者与版本保留，不增加任务证明或奖励。":"打印结果未确认，本次没有再次扣物。先核对背包；确实缺书再用新的请求标识主动恢复。");
        });
    }
    private ArchiveStore.Entry visible(String id,int version,UUID reader)throws Exception{
        var latest=store.get(id,0);if(latest==null||!latest.published()&&!latest.author().equals(reader.toString()))return null;
        // Withdrawal takes effect from the photo's saved source even while the
        // background archive batch is still reconciling an earlier snapshot.
        if(latest.kind().equals("photo")&&!latest.author().equals(reader.toString())){
            Path file=plugin.getDataFolder().toPath().resolve("photo-journal.json");
            if(Files.isRegularFile(file)){
                if(Files.size(file)>16*1024*1024)throw new IllegalArgumentException("Photo source exceeds read limit");
                JsonObject source=JsonParser.parseString(Files.readString(file)).getAsJsonObject().getAsJsonObject("players").getAsJsonObject(latest.author());
                JsonObject photos=source==null?null:source.getAsJsonObject("photos"),row=photos==null?null:photos.getAsJsonObject(id);
                if(row!=null&&!row.get("published").getAsBoolean())return null;
            }
        }
        return version==0?latest:store.get(id,version);
    }
    private ItemStack book(ArchiveStore.Entry e,String copy){
        ItemStack item=new ItemStack(Material.WRITTEN_BOOK);BookMeta m=(BookMeta)item.getItemMeta();
        m.setTitle(e.title().substring(0,Math.min(32,e.title().length())));m.setAuthor(e.authorName());m.setGeneration(copy.equals("original")?BookMeta.Generation.ORIGINAL:BookMeta.Generation.COPY_OF_ORIGINAL);
        String at=DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.of("Asia/Shanghai")).format(Instant.ofEpochMilli(e.createdAt()));
        String text=e.title()+"\n作者："+e.authorName()+"\n"+at+" · 第"+e.version()+"版\n\n"+e.body();
        List<String> pages=new ArrayList<>();JsonObject metadata=JsonParser.parseString(e.metadata()).getAsJsonObject();
        if(metadata.has("pages")){for(JsonElement page:metadata.getAsJsonArray("pages"))pages.add(page.getAsString());}
        else pages.addAll(splitText(text,800));
        if(pages.size()>100)throw new IllegalArgumentException("原文超过实体书容量；请用 archive read 分页阅读，不能截断恢复");
        if(pages.size()<100)pages.add("千灯纪公共档案馆\n作品："+e.id()+"\n可在档案目录阅读或恢复。\n副本不产生新的任务/摄影证明。");m.setPages(pages);
        m.getPersistentDataContainer().set(entryKey,PersistentDataType.STRING,e.id());m.getPersistentDataContainer().set(versionKey,PersistentDataType.INTEGER,e.version());m.getPersistentDataContainer().set(copyKey,PersistentDataType.STRING,copy);
        item.setItemMeta(m);return item;
    }
    private JsonObject base(String type,boolean readOnly){JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("type",type);out.addProperty("readOnly",readOnly);return out;}
    private JsonObject summary(ArchiveStore.Entry e){JsonObject out=base("entry",true);out.addProperty("id",e.id());out.addProperty("kind",e.kind());out.addProperty("title",e.title());out.addProperty("author",e.authorName());out.addProperty("authorUuid",e.author());out.addProperty("version",e.version());out.addProperty("createdAt",e.createdAt());out.addProperty("published",e.published());return out;}
    private void reply(Player p,Query q,JsonObject out,String human){
        out.addProperty("scope","self");out.addProperty("playerUuid",p.getUniqueId().toString());
        plugin.communication().stamp(p,out);
        if(q.json||plugin.communication().compact(p))p.sendMessage("MC_ARCHIVE "+out);else p.sendMessage("§6[公共档案馆] §f"+human);
        for(Player eye:plugin.attachedEyes(p))eye.sendMessage("§6[公共档案馆] §f"+human);
    }
    private void error(Player p,String code,String message,boolean retry){error(p,false,code,message,retry);}
    private void error(Player p,boolean json,String code,String message,boolean retry){JsonObject out=base("error",true);out.addProperty("errorCode",code);out.addProperty("message",message);out.addProperty("retryable",retry);out.addProperty("nextCommand","/mycli archive status");reply(p,new Query("error",List.of(),json,1,"",0),out,message);}
    private static String plain(String text){return ChatColor.stripColor(text.replaceAll("(?i)§[0-9A-FK-ORX]","")).replaceAll("[\\p{Cc}&&[^\\n\\t]]","");}
    static List<String> splitText(String text,int size){
        if(size<2)throw new IllegalArgumentException("Page size too small");if(text.isEmpty())return List.of("");
        List<String> out=new ArrayList<>();for(int start=0;start<text.length();){int end=Math.min(text.length(),start+size);if(end<text.length()&&Character.isHighSurrogate(text.charAt(end-1)))end--;out.add(text.substring(start,end));start=end;}return List.copyOf(out);
    }

    private void open(Player p,String kind,int page,List<ArchiveStore.Entry> rows){
        Inventory inv=Bukkit.createInventory(null,27,"千灯纪公共档案馆 · "+page);menus.put(inv,new Menu(p.getUniqueId(),page,kind,rows));
        for(int i=0;i<rows.size();i++){var e=rows.get(i);ItemStack icon=new ItemStack(e.kind().equals("photo")?Material.FILLED_MAP:Material.WRITTEN_BOOK);var m=icon.getItemMeta();m.setDisplayName("§f"+e.title());m.setLore(List.of("§7作者："+e.authorName(),"§7第"+e.version()+"版 · 点击阅读","§8"+e.id()));icon.setItemMeta(m);inv.setItem(i+10,icon);}
        inv.setItem(18,new ItemStack(Material.ARROW));inv.setItem(26,new ItemStack(Material.ARROW));p.openInventory(inv);
    }
    @EventHandler(priority=EventPriority.HIGHEST)public void click(InventoryClickEvent e){
        Menu m=menus.get(e.getView().getTopInventory());if(m==null)return;e.setCancelled(true);
        if(!(e.getWhoClicked() instanceof Player p)||!p.getUniqueId().equals(m.reader))return;
        int slot=e.getRawSlot();if(slot>=10&&slot<10+m.entries.size()){command(p,new String[]{"archive","read",m.entries.get(slot-10).id()});return;}
        if(slot==18&&m.page>1||slot==26&&m.entries.size()==7)command(p,m.kind.isEmpty()?new String[]{"archive","menu","--page",Integer.toString(m.page+(slot==18?-1:1))}:new String[]{"archive","menu",m.kind,"--page",Integer.toString(m.page+(slot==18?-1:1))});
    }
    @EventHandler(priority=EventPriority.HIGHEST)public void drag(InventoryDragEvent e){if(menus.containsKey(e.getView().getTopInventory()))e.setCancelled(true);}
    @EventHandler public void close(InventoryCloseEvent e){menus.remove(e.getInventory());}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void desk(PlayerInteractEvent e){
        if(e.getHand()!=EquipmentSlot.HAND||e.getAction()!=org.bukkit.event.block.Action.RIGHT_CLICK_BLOCK||e.getClickedBlock()==null||e.getClickedBlock().getType()!=Material.LECTERN)return;
        var b=e.getClickedBlock();if(!desks.contains(b.getWorld().getName()+":"+b.getX()+":"+b.getY()+":"+b.getZ()))return;
        e.setCancelled(true);command(e.getPlayer(),new String[]{"archive","menu"});
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)public void signed(PlayerEditBookEvent event){
        if(!event.isSigning())return;Player p=event.getPlayer();BookMeta meta=event.getNewBookMeta();
        if(meta.getPersistentDataContainer().has(entryKey,PersistentDataType.STRING))return;
        String title=meta.getTitle(),body=String.join("\n\n",meta.getPages());if(title==null||title.isBlank()||body.isBlank())return;
        UUID owner=p.getUniqueId();String name=p.getName();int slot=event.getSlot();String id=UUID.randomUUID().toString();
        Bukkit.getScheduler().runTask(plugin,()->{
            if(!inSession(p))return;ItemStack actual=p.getInventory().getItem(slot);
            if(actual==null||actual.getType()!=Material.WRITTEN_BOOK||!(actual.getItemMeta() instanceof BookMeta saved)||!Objects.equals(saved.getTitle(),title)||!String.join("\n\n",saved.getPages()).equals(body))return;
            ItemStack expected=actual.clone();JsonObject originalMeta=new JsonObject();originalMeta.addProperty("source","native_signed_book");JsonArray originalPages=new JsonArray();saved.getPages().forEach(originalPages::add);originalMeta.add("pages",originalPages);
            var entry=new ArchiveStore.Entry(id,"book",owner.toString(),name,plain(title),plain(body),originalMeta.toString(),true,System.currentTimeMillis(),1);
            work(p,new Query("native_sign",List.of(),false,1,id,0),()->store.create("native:"+id,entry),written->{
                if(expected.equals(p.getInventory().getItem(slot))){BookMeta original=(BookMeta)expected.getItemMeta();original.getPersistentDataContainer().set(entryKey,PersistentDataType.STRING,written.id());original.getPersistentDataContainer().set(versionKey,PersistentDataType.INTEGER,1);original.getPersistentDataContainer().set(copyKey,PersistentDataType.STRING,"original");expected.setItemMeta(original);p.getInventory().setItem(slot,expected);}
                reply(p,new Query("create",List.of(),false,1,id,0),summary(written),"《"+written.title()+"》原版签名书已收入公共档案；/mycli archive info "+written.id()+" 查询，遗失可恢复副本。");
            });
        });
    }

    /** Read only persisted source files, off-thread; queries never refresh or create gameplay proof. */
    void syncSources(){
        if(!ready||closing||io.getQueue().size()>8||!sourceQueued.compareAndSet(false,true))return;
        try{io.execute(()->{
            try{for(Source s:savedSources())try{importSource(s);}catch(Exception e){plugin.getLogger().warning("Archive source retained for next reconciliation: "+s.kind+" "+e.getClass().getSimpleName());}}
            catch(Exception e){plugin.getLogger().warning("Archive source snapshot not confirmed; retained originals: "+e.getClass().getSimpleName());}
            finally{sourceQueued.set(false);}
        });}catch(RejectedExecutionException ignored){sourceQueued.set(false);/* Original ledgers remain available for the next scan. */}
    }
    private List<Source> savedSources()throws Exception{
        List<Source> sources=new ArrayList<>();
        Path folder=plugin.getDataFolder().toPath(),photos=folder.resolve("photo-journal.json");
        if(Files.isRegularFile(photos)){
        if(Files.size(photos)>16*1024*1024)throw new IllegalArgumentException("Photo journal exceeds source limit");
        JsonObject journal=JsonParser.parseString(Files.readString(photos)).getAsJsonObject();
        for(var player:journal.getAsJsonObject("players").entrySet()){
        JsonObject rows=player.getValue().getAsJsonObject().getAsJsonObject("photos");if(rows==null)continue;
        for(var photo:rows.entrySet()){
            JsonObject row=photo.getValue().getAsJsonObject();
            String id=row.get("id").getAsString(),owner=row.get("owner").getAsString();
            sources.add(new Source(owner,row.get("author").getAsString(),"photo:"+id+":"+stable(row),id,"photo",row.get("title").getAsString(),row.get("story").getAsString(),row.toString(),row.get("published").getAsBoolean(),row.get("capturedAt").getAsLong()));
        }}}
        Map<String,String> names=new HashMap<>();Path cache=folder.toAbsolutePath().getParent().getParent().resolve("usercache.json");
        if(Files.isRegularFile(cache))for(JsonElement p:JsonParser.parseString(Files.readString(cache)).getAsJsonArray()){JsonObject row=p.getAsJsonObject();names.put(row.get("uuid").getAsString(),row.get("name").getAsString());}
        // Also preserve manual/old ImageFrame originals and future photographs
        // beyond the bounded exam album. Missing scene data never grants proof.
        Set<Integer> represented=new HashSet<>();for(Source s:sources)if(s.kind.equals("photo"))represented.add(JsonParser.parseString(s.metadata).getAsJsonObject().get("imageIndex").getAsInt());
        Map<Integer,ArchiveStore.Entry> indexed=store.photoIndex();Path imageData=folder.getParent().resolve("ImageFrame/data");
        if(Files.isDirectory(imageData))try(var dirs=Files.list(imageData)){
            Path boundary=imageData.toRealPath();
            for(Path dir:dirs.toList()){
                String number=dir.getFileName().toString();if(!number.matches("[0-9]{1,9}"))continue;int index=Integer.parseInt(number);if(represented.contains(index))continue;
                var previous=indexed.get(index);if(previous!=null&&!previous.metadata().contains("\"source\":\"native_imageframe\""))continue;
                Path manifest=dir.resolve("data.json");if(!Files.isRegularFile(manifest)||!manifest.toRealPath().startsWith(boundary)||Files.size(manifest)>1024*1024)continue;
                JsonObject nativeMap=JsonParser.parseString(Files.readString(manifest)).getAsJsonObject();if(!nativeMap.has("creator")||!nativeMap.has("creationTime")||!nativeMap.has("name"))continue;
                String author=UUID.fromString(nativeMap.get("creator").getAsString()).toString(),name=plain(nativeMap.get("name").getAsString());
                String id=UUID.nameUUIDFromBytes(("imageframe-original:"+index).getBytes(StandardCharsets.UTF_8)).toString();long at=nativeMap.get("creationTime").getAsLong();
                JsonObject row=new JsonObject();row.addProperty("source","native_imageframe");row.addProperty("imageIndex",index);row.addProperty("owner",author);row.addProperty("sceneMetadataUnavailable",true);row.addProperty("name",name);row.addProperty("published",false);
                sources.add(new Source(author,names.getOrDefault(author,author),"native-image:"+index,id,"photo",name.substring(0,Math.min(128,name.length())),"ImageFrame原作资料；没有现场走查或考试证明。",row.toString(),false,at));
            }
        }
        YamlConfiguration config=new YamlConfiguration();Path savedConfig=folder.resolve("config.yml");
        if(Files.size(savedConfig)>32*1024*1024)throw new IllegalArgumentException("Gameplay source exceeds archive import limit");config.load(savedConfig.toFile());
        ConfigurationSection assessments=config.getConfigurationSection("task-market.assessments");
        if(assessments!=null)for(String author:assessments.getKeys(false))for(Map<?,?> history:config.getMapList("task-market.assessments."+author+".history")){
            UUID.fromString(author);
            String run=Objects.toString(history.get("run"),"");if(run.isBlank())continue;
            String id=UUID.nameUUIDFromBytes(("market:"+author+":"+run).getBytes(StandardCharsets.UTF_8)).toString();
            String title=Objects.toString(history.get("title"),"公会委托"),outcome=Objects.toString(history.get("outcome"),"unknown");
            String metadata=new Gson().toJson(history);
            sources.add(new Source(author,names.getOrDefault(author,author),"market:"+run+":"+outcome,id,"event",title,"公会委托记录："+outcome+"。这是服务端已保存的履历，不代表完整聊天或全部游戏动作。",metadata,true,history.get("at") instanceof Number n?n.longValue():0));
        }
        return sources;
    }
    private static String stable(JsonObject row){try{return ArchiveStore.digest(row.toString().getBytes(StandardCharsets.UTF_8)).substring(0,20);}catch(Exception e){throw new IllegalStateException(e);}}
    private void importSource(Source s)throws Exception{
        var old=store.get(s.id,0);if(old!=null&&old.metadata().equals(s.metadata))return;
        if(old!=null&&s.kind.equals("photo")){
            JsonObject prior=JsonParser.parseString(old.metadata()).getAsJsonObject();JsonElement state=prior.remove("archiveAssetState");
            if(prior.toString().equals(s.metadata)&&state!=null&&state.getAsString().equals("original_bytes_saved"))return;
        }
        List<ArchiveStore.Attachment> blobs=s.kind.equals("photo")?photoAssets(JsonParser.parseString(s.metadata).getAsJsonObject()):List.of();
        JsonObject metadata=JsonParser.parseString(s.metadata).getAsJsonObject();
        if(s.kind.equals("photo"))metadata.addProperty("archiveAssetState",blobs.stream().anyMatch(b->b.name().equals("original.png"))?"original_bytes_saved":blobs.stream().anyMatch(b->b.mime().equals("image/png"))?"tiles_saved":"source_missing");
        var entry=new ArchiveStore.Entry(s.id,s.kind,s.author,s.name,s.title,s.body,metadata.toString(),s.published,s.at,old==null?1:old.version()+1);
        // Compare the source fields rather than the archival annotation on subsequent scans.
        if(old!=null&&old.metadata().equals(metadata.toString()))return;
        String assetDigest=s.kind.equals("photo")?":"+ArchiveStore.digest((metadata.toString()+blobs.stream().map(b->{try{return ArchiveStore.digest(b.bytes());}catch(Exception e){throw new IllegalStateException(e);}}).toList()).getBytes(StandardCharsets.UTF_8)).substring(0,12):"";
        store.create(s.request+assetDigest,entry,blobs);
    }
    private List<ArchiveStore.Attachment> photoAssets(JsonObject row)throws Exception{
        Path root=plugin.getDataFolder().toPath().getParent().resolve("ImageFrame").toRealPath();
        int index=row.get("imageIndex").getAsInt();if(index<0)throw new IllegalArgumentException("Invalid ImageFrame index");
        Path data=root.resolve("data").resolve(Integer.toString(index)).resolve("data.json");
        if(!Files.isRegularFile(data))return List.of();
        Path manifest=data.toRealPath();if(!manifest.startsWith(root))throw new SecurityException("Image source escaped ImageFrame");
        if(Files.size(manifest)>1024*1024)throw new IllegalArgumentException("Image manifest too large");
        JsonObject image=JsonParser.parseString(Files.readString(manifest)).getAsJsonObject();
        List<ArchiveStore.Attachment> blobs=new ArrayList<>();blobs.add(new ArchiveStore.Attachment("imageframe.json","application/json",Files.readAllBytes(manifest)));
        if(image.has("url")){
            java.net.URI uri=java.net.URI.create(image.get("url").getAsString());
            if("file".equalsIgnoreCase(uri.getScheme())){
                Path original=Path.of(uri);if(Files.isRegularFile(original)){
                    Path trusted=root.resolve("upload/images").toRealPath(),resolved=original.toRealPath();
                    if(resolved.startsWith(trusted)&&resolved.getFileName().toString().endsWith(".png"))blobs.add(new ArchiveStore.Attachment("original.png","image/png",readImage(resolved)));
                }
            }
        }
        if(image.has("mapdata"))for(JsonElement tile:image.getAsJsonArray("mapdata")){
            String name=tile.getAsJsonObject().get("image").getAsString();if(!name.matches("[0-9]+\\.png"))throw new IllegalArgumentException("Invalid tile name");
            Path file=manifest.getParent().resolve(name);if(!Files.isRegularFile(file))continue;
            Path resolved=file.toRealPath();if(!resolved.startsWith(manifest.getParent()))throw new SecurityException("Image tile escaped source");
            blobs.add(new ArchiveStore.Attachment("tile-"+name,"image/png",readImage(resolved)));
        }
        return blobs;
    }
    private static byte[] readImage(Path file)throws Exception{if(Files.size(file)>16*1024*1024)throw new IllegalArgumentException("Image exceeds archive limit");return Files.readAllBytes(file);}
    void shutdown(){
        syncSources();closing=true;ready=false;menus.clear();io.shutdown();
        try{if(!io.awaitTermination(10,TimeUnit.SECONDS)){plugin.getLogger().warning("Archive worker still draining; originals remain in source ledgers");return;}
            if(store!=null)store.close();
        }catch(Exception e){plugin.getLogger().warning("Archive checkpoint incomplete; SQLite WAL retained: "+e.getClass().getSimpleName());}
    }
}
