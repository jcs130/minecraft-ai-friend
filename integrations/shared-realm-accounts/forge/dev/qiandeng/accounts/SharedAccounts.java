package dev.qiandeng.accounts;

import com.google.gson.*;
import com.marcp.directauth.DirectAuth;
import com.marcp.directauth.auth.AuthTasks;
import com.marcp.directauth.events.PlayerRestrictionHandler;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.CommandEvent;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.event.entity.player.PlayerEvent;
import net.minecraftforge.event.server.ServerAboutToStartEvent;
import net.minecraftforge.event.server.ServerStoppedEvent;
import net.minecraftforge.eventbus.api.EventPriority;
import net.minecraftforge.fml.common.Mod;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import static dev.qiandeng.accounts.BridgeFiles.text;

/** Optional server-only Forge adapter. Authentication stays in native providers. */
@Mod("maw_shared_accounts")
public final class SharedAccounts {
    private static volatile SharedAccounts INSTANCE;
    private final Map<UUID,JsonObject> members=new ConcurrentHashMap<>();
    private final Set<UUID> preexistingBodies=ConcurrentHashMap.newKeySet();
    private final ThreadLocal<Boolean> nativePass=ThreadLocal.withInitial(()->false);
    private final ExecutorService worker=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"shared-realm-auth");t.setDaemon(true);return t;});
    private BridgeFiles bridge;
    private Path requiredMarker;
    public SharedAccounts(){INSTANCE=this;MinecraftForge.EVENT_BUS.addListener(this::start);MinecraftForge.EVENT_BUS.addListener(this::stop);
        MinecraftForge.EVENT_BUS.addListener(this::commands);MinecraftForge.EVENT_BUS.addListener(this::join);
        MinecraftForge.EVENT_BUS.addListener(EventPriority.HIGHEST,this::command);}
    private void start(ServerAboutToStartEvent event){
        Path config=Path.of("config/maw-shared-accounts.properties");
        requiredMarker=event.getServer().getWorldPath(net.minecraft.world.level.storage.LevelResource.ROOT).resolve("data/maw-shared-accounts-required.json");
        if(!Files.exists(config)){
            if(Files.exists(requiredMarker))throw new IllegalStateException("Linked shared accounts require their original adapter configuration");
            return;
        }
        try {
            Properties p=new Properties();try(var in=Files.newInputStream(config)){p.load(in);}
            if(!p.getProperty("enabled","false").equals("true")){
                Path members=Path.of(p.getProperty("directory")).resolve("members");
                boolean linked=Files.exists(requiredMarker);if(Files.isDirectory(members))try(var list=Files.list(members)){linked|=list.anyMatch(f->f.toString().endsWith(".json"));}
                if(linked)throw new IllegalStateException("Cannot disable the authority for linked accounts");return;
            }
            bridge=new BridgeFiles(Path.of(p.getProperty("directory")),Path.of(p.getProperty("keyFile")),p.getProperty("realmId"));
            Files.createDirectories(bridge.root.resolve("client-results"));Files.createDirectories(bridge.root.resolve("links"));Files.createDirectories(bridge.root.resolve("unregistered"));
            try(var files=Files.list(bridge.root.resolve("members"))){for(Path f:files.filter(x->x.getFileName().toString().matches("[a-f0-9-]{36}\\.json")).toList()){
                UUID id=UUID.fromString(f.getFileName().toString().substring(0,36));JsonObject row=bridge.read(f,"member:"+id);
                if(!id.toString().equals(text(row,"bodyUuid")))throw new IllegalStateException("MEMBER_IDENTITY_INVALID");members.put(id,row);
            }}
            if(Files.exists(requiredMarker)&&members.isEmpty()){
                JsonObject marker=JsonParser.parseString(Files.readString(requiredMarker)).getAsJsonObject();
                if(!text(marker,"phase").equals("pending"))throw new IllegalStateException("Linked membership store is missing; reconcile original receipts");
            }
            if(!members.isEmpty())requireAdapter(true);
        }catch(Exception broken){throw new IllegalStateException("Shared account configuration cannot be validated",broken);}
    }
    private void stop(ServerStoppedEvent event){worker.shutdownNow();}
    public static boolean isShared(ServerPlayer player){return INSTANCE!=null&&INSTANCE.members.containsKey(player.getUUID());}
    private void join(PlayerEvent.PlayerLoggedInEvent event){
        if(bridge==null||!(event.getEntity() instanceof ServerPlayer p))return;
        Path file=p.getServer().getWorldPath(net.minecraft.world.level.storage.LevelResource.PLAYER_DATA_DIR).resolve(p.getUUID()+".dat");
        UUID id=p.getUUID();String name=p.getGameProfile().getName();Path provisional=bridge.root.resolve("unregistered").resolve(id+".json");
        boolean pristine=!Files.exists(file);
        try{if(!pristine&&Files.exists(provisional)){JsonObject row=bridge.read(provisional,"unregistered:"+id);pristine=id.toString().equals(text(row,"bodyUuid"))&&name.equals(text(row,"bodyName"));}}catch(Exception invalid){pristine=false;}
        if(!pristine)preexistingBodies.add(id);
        else if(!Files.exists(provisional))DirectAuth.getDatabase().getUserAsync(name).thenAcceptAsync(user->{
            if(user!=null)return;try{JsonObject row=new JsonObject();row.addProperty("bodyUuid",id.toString());row.addProperty("bodyName",name);row.addProperty("observedPristineAt",System.currentTimeMillis());bridge.write(provisional,"unregistered:"+id,row,true);}catch(FileAlreadyExistsException duplicate){}catch(Exception unavailable){/* No marker means no automatic adoption on reconnect. */}
        },worker);
        p.sendSystemMessage(Component.literal("本服与千灯纪共用游戏账号。已有千灯纪角色可 /login 原游戏密码；旧SAO角色登录后用 /sharedaccount link 原角色名 原游戏密码 关联。"));
    }
    private void commands(RegisterCommandsEvent event){
        event.getDispatcher().register(Commands.literal("sharedaccount")
            .then(Commands.literal("link").then(Commands.argument("primaryName",StringArgumentType.word()).then(Commands.argument("password",StringArgumentType.greedyString()).executes(c->{
                ServerPlayer p=c.getSource().getPlayerOrException();
                if(bridge==null){say(p,"账号桥未启用。");return 0;}
                if(localReserved(p)){reject(p,"RESERVED_ACCOUNT",false,0);return 0;}
                if(!DirectAuth.getLoginManager().isAuthenticated(p)){say(p,"先用此SAO角色的原密码登录，再关联千灯纪角色；不会按同名覆盖旧身体。");return 0;}
                if(members.containsKey(p.getUUID())){say(p,"当前身体已关联千灯纪账号，无需重复关联。");return 0;}
                begin(p,"verify",StringArgumentType.getString(c,"primaryName"),StringArgumentType.getString(c,"password"),null,true);return 1;
            }))))
            .then(Commands.literal("status").executes(c->{
                ServerPlayer p=c.getSource().getPlayerOrException();JsonObject r=new JsonObject();r.addProperty("schemaVersion",1);r.addProperty("bodyUuid",p.getUUID().toString());r.addProperty("bodyName",p.getGameProfile().getName());
                r.addProperty("linked",members.containsKey(p.getUUID()));r.addProperty("authenticated",DirectAuth.getLoginManager().isAuthenticated(p));
                if(members.containsKey(p.getUUID())){r.addProperty("primaryName",text(members.get(p.getUUID()),"primaryName"));r.addProperty("primaryUuid",text(members.get(p.getUUID()),"primaryUuid"));}
                say(p,"MC_SHARED_ACCOUNT "+r);return 1;
            }).then(Commands.argument("requestId",StringArgumentType.word()).executes(c->{
                ServerPlayer p=c.getSource().getPlayerOrException();String id=StringArgumentType.getString(c,"requestId");
                try{UUID.fromString(id);if(bridge==null)return 0;JsonObject result=bridge.read(bridge.root.resolve("client-results").resolve(id+".json"),"client-result:"+id);
                    if(!p.getUUID().toString().equals(text(result,"bodyUuid")))throw new IllegalArgumentException();receipt(p,result);
                }catch(Exception e){say(p,"未找到属于此身体的正式回执；不要重放结果未知的改密请求。");}return 1;
            })))
            .executes(c->{say(c.getSource().getPlayerOrException(),"已有账号：/login 千灯纪游戏密码；关联旧身体：/sharedaccount link 千灯纪角色名 游戏密码；改密：/changepassword 旧密码 新密码。");return 1;}));
    }
    private void command(CommandEvent event){
        if(bridge==null||nativePass.get()||!(event.getParseResults().getContext().getSource().getEntity() instanceof ServerPlayer p))return;
        String raw=event.getParseResults().getReader().getString();String[] parts=raw.strip().replaceFirst("^/","").split("\\s+");
        String cmd=parts[0].toLowerCase(Locale.ROOT);JsonObject member=members.get(p.getUUID());
        if(cmd.equals("changepassword")&&member!=null){event.setCanceled(true);
            if(!DirectAuth.getLoginManager().isAuthenticated(p)){say(p,"请先登录。");return;}
            if(parts.length!=3){say(p,"用法：/changepassword 旧游戏密码 新游戏密码。");return;}
            begin(p,"password",text(member,"primaryName"),parts[1],parts[2],false);return;
        }
        if(member!=null&&Set.of("register","unregister","online","onlinemode").contains(cmd)){event.setCanceled(true);say(p,"当前身体使用千灯纪统一账号；请在网站管理绑定或使用 /changepassword 旧密码 新密码。");return;}
        if(!Set.of("login","register").contains(cmd))return;
        if(DirectAuth.getLoginManager().isAuthenticated(p))return;
        event.setCanceled(true);
        if(parts.length!=2&&parts.length!=3){say(p,"用法：/login 游戏密码；新身体名字不同可 /login 千灯纪角色名 游戏密码。");return;}
        if(member!=null){
            if(parts.length==3&&!parts[1].equals(text(member,"primaryName"))){reject(p,"MEMBERSHIP_IDENTITY_MISMATCH",false,0);return;}
            begin(p,"verify",text(member,"primaryName"),parts[parts.length-1],null,false);return;
        }
        // Only an unchanged native account may follow its old authentication path.
        // New bodies need a verified website-owned primary role, not a second registration.
        DirectAuth.getDatabase().getUserAsync(p.getGameProfile().getName()).whenComplete((user,error)->p.getServer().execute(()->{
            if(!current(p))return;
            if(error!=null){say(p,"原生账号读取失败，未执行登录或注册。");return;}
            if(user!=null){
                if(parts.length==3){reject(p,"OLD_BODY_REQUIRES_PROOF",false,0);return;}
                nativePass.set(true);try{p.getServer().getCommands().performPrefixedCommand(p.createCommandSourceStack(),raw);}finally{nativePass.remove();}return;
            }
            if(cmd.equals("register")){say(p,"先在 mc.kangqiang.site 注册并创建或绑定游戏角色，然后 /login 该角色的游戏密码。");return;}
            if(localReserved(p)){reject(p,"RESERVED_ACCOUNT",false,0);return;}
            if(preexistingBodies.contains(p.getUUID())){reject(p,"OLD_BODY_REQUIRES_PROOF",false,0);return;}
            begin(p,"verify",parts.length==3?parts[1]:p.getGameProfile().getName(),parts[parts.length-1],null,true);
        }));
    }
    private boolean current(ServerPlayer p){return p.getServer()!=null&&p.getServer().getPlayerList().getPlayer(p.getUUID())==p;}
    private boolean localReserved(ServerPlayer p){String name=p.getGameProfile().getName().toLowerCase(Locale.ROOT);return p.getServer().getPlayerList().isOp(p.getGameProfile())||name.endsWith("eye")||Set.of("goddess","corticam","player","live").contains(name);}
    private void begin(ServerPlayer p,String operation,String name,String password,String next,boolean link){
        var manager=DirectAuth.getLoginManager();
        if(manager.hasExceededMaxAttempts(p)){reject(p,"PASSWORD_BLOCKED",false,0);return;}
        if(!manager.canAttemptLogin(p)){reject(p,"LOGIN_COOLDOWN",true,DirectAuth.getConfig().loginCooldownMs);return;}
        if(!AuthTasks.begin(p)){reject(p,"ACCOUNT_BUSY",true,1000);return;}manager.markLoginAttempt(p);
        String id=UUID.randomUUID().toString();UUID bodyId=p.getUUID();boolean oldBodyProved=manager.isAuthenticated(p);
        CompletableFuture<JsonObject> task=CompletableFuture.supplyAsync(()->{
            boolean dispatched=false;
            try{
                JsonObject existing=members.get(bodyId);
                JsonObject role=existing==null?bridge.role(name):new JsonObject();
                if(existing!=null){role.addProperty("name",text(existing,"primaryName"));role.addProperty("uuid",text(existing,"primaryUuid"));}
                if(role==null||!name.equals(text(role,"name")))throw new IllegalStateException("WEBSITE_ROLE_REQUIRED");
                JsonObject heartbeat=bridge.read(bridge.root.resolve("authority-heartbeat.json"),"authority-heartbeat");long now=System.currentTimeMillis();
                if(!heartbeat.get("ready").getAsBoolean()||now-heartbeat.get("at").getAsLong()>5000)throw new IllegalStateException("AUTHORITY_OFFLINE");
                JsonObject req=new JsonObject();req.addProperty("requestId",id);req.addProperty("operation",operation);req.addProperty("primaryName",name);req.addProperty("primaryUuid",text(role,"uuid"));
                req.addProperty("bodyName",p.getGameProfile().getName());req.addProperty("bodyUuid",bodyId.toString());req.addProperty("password",password);if(next!=null)req.addProperty("newPassword",next);
                dispatched=true;JsonObject result=bridge.request(req);result.addProperty("accepted",true);
                if(text(result,"state").equals("succeeded")&&link){
                    JsonObject member=new JsonObject();for(String k:List.of("bodyName","bodyUuid","primaryName","primaryUuid"))member.addProperty(k,text(result,k));member.addProperty("linkedAt",System.currentTimeMillis());
                    JsonObject journal=member.deepCopy();journal.addProperty("requestId",id);journal.addProperty("phase","accepted");
                    bridge.write(bridge.root.resolve("links").resolve(id+".json"),"link:"+id,journal,true);
                    requireAdapter(false);
                    // A new primary credential never replaces an existing target's hash or UUID.
                    var user=DirectAuth.getDatabase().getUserAsync(text(result,"bodyName")).get(5,TimeUnit.SECONDS);
                    if(user!=null&&!oldBodyProved)throw new IllegalStateException("TARGET_ACCOUNT_CHANGED");
                    if(user==null){
                        String randomSecret=UUID.randomUUID().toString()+UUID.randomUUID();
                        String hash=DirectAuth.getLoginManager().hashPasswordAsync(randomSecret).get(5,TimeUnit.SECONDS);
                        var registered=DirectAuth.getDatabase().registerUserAsync(text(result,"bodyName"),hash,null,1).get(5,TimeUnit.SECONDS);
                        if(!registered.toString().equals("OK"))throw new IllegalStateException("TARGET_ACCOUNT_CHANGED");
                        DirectAuth.getDatabase().setOnlineModeAsync(text(result,"bodyName"),false,null,bodyId.toString()).get(5,TimeUnit.SECONDS);
                    }
                    bridge.write(bridge.root.resolve("members").resolve(bodyId+".json"),"member:"+bodyId,member,true);members.put(bodyId,member);requireAdapter(true);
                    journal.addProperty("phase","completed");bridge.write(bridge.root.resolve("links").resolve(id+".json"),"link:"+id,journal,false);
                }
                return result;
            }catch(Exception error){JsonObject result=new JsonObject();result.addProperty("requestId",id);result.addProperty("state",dispatched?"unknown":"failed");result.addProperty("accepted",dispatched);
                String reason=error instanceof IllegalStateException?error.getMessage():"AUTH_RESULT_UNKNOWN";
                result.addProperty("reason",Set.of("WEBSITE_ROLE_REQUIRED","AUTHORITY_OFFLINE","OWNERSHIP_FEED_UNAVAILABLE","TARGET_ACCOUNT_CHANGED").contains(reason)?reason:"AUTH_RESULT_UNKNOWN");result.addProperty("bodyUuid",bodyId.toString());return result;}
        },worker);
        AuthTasks.finish(p,task,(player,result)->{
            boolean ok=text(result,"state").equals("succeeded");if(ok||text(result,"reason").equals("PASSWORD_INCORRECT"))manager.recordLoginResult(player,ok);
            if(ok&&operation.equals("verify")&&!manager.isAuthenticated(player)){
                manager.invalidateSession(player);manager.setAuthenticated(player,true);
                if(!DirectAuth.getPositionManager().restorePosition(player)){
                    var server=player.getServer();var level=server.getLevel(player.getRespawnDimension());var pos=player.getRespawnPosition();
                    var respawn=level!=null&&pos!=null?net.minecraft.world.entity.player.Player.findRespawnPositionAndUseSpawnBlock(level,pos,player.getRespawnAngle(),player.isRespawnForced(),false):Optional.<net.minecraft.world.phys.Vec3>empty();
                    if(respawn.isPresent()){var at=respawn.get();player.teleportTo(level,at.x,at.y,at.z,player.getRespawnAngle(),0);}
                    else{var world=server.overworld();var spawn=world.getSharedSpawnPos();if(player.level()!=world)player.teleportTo(world,spawn.getX()+0.5,spawn.getY(),spawn.getZ()+0.5,0,0);
                        ((com.marcp.directauth.mixin.ServerPlayerAccessor)player).callFudgeSpawnLocation(world);player.teleportTo(world,player.getX(),player.getY(),player.getZ(),0,0);}
                }
                PlayerRestrictionHandler.release(player);
            }
            result.addProperty("authenticated",manager.isAuthenticated(player));
            result.addProperty("linked",members.containsKey(bodyId));result.addProperty("completedAt",System.currentTimeMillis());
            try{bridge.write(bridge.root.resolve("client-results").resolve(id+".json"),"client-result:"+id,result,false);}catch(Exception e){say(player,"本地完成回执写入失败；保留原请求ID核对，不要重复改密。");}
            receipt(player,result);
        });
    }
    private void requireAdapter(boolean committed) throws Exception {
        if(Files.exists(requiredMarker)){
            JsonObject prior=JsonParser.parseString(Files.readString(requiredMarker)).getAsJsonObject();
            if(!committed||!text(prior,"phase").equals("pending"))return;
        }
        Files.createDirectories(requiredMarker.getParent());Path temporary=requiredMarker.resolveSibling(requiredMarker.getFileName()+"."+UUID.randomUUID()+".tmp");
        try{
            Files.writeString(temporary,"{\"schemaVersion\":1,\"sharedAccountAuthorityRequired\":true,\"phase\":\""+(committed?"active":"pending")+"\"}",StandardOpenOption.CREATE_NEW);
            try(var channel=java.nio.channels.FileChannel.open(temporary,StandardOpenOption.WRITE)){channel.force(true);}
            Files.move(temporary,requiredMarker,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        }finally{Files.deleteIfExists(temporary);}
    }
    private static void receipt(ServerPlayer p,JsonObject result){
        String reason=text(result,"reason");String message=text(result,"state").equals("succeeded")?(reason.equals("PASSWORD_CHANGED")?"统一游戏密码已更新，后续登录千灯纪与SAO都使用新密码。":"千灯纪账号验证成功，已进入SAO。")
            :switch(reason){case "WEBSITE_ROLE_REQUIRED"->"请先在 mc.kangqiang.site 创建或绑定该游戏角色；名字大小写须准确。";case "PASSWORD_INCORRECT"->"千灯纪游戏密码不正确。";case "PASSWORD_BLOCKED"->"密码核验次数过多，请五分钟后再试。";case "LOGIN_COOLDOWN","ACCOUNT_BUSY"->"操作尚未受理，请按 retryAfterMs 等待后再试。";case "OLD_BODY_REQUIRES_PROOF"->"检测到旧身体但没有原生账号，请联系服主核对；未自动接管。";case "RESERVED_ACCOUNT","TOTP_IN_PRIMARY_REALM"->"此管理或两步验证身份需要保留原认证，请联系服主。";case "PASSWORD_WEAK"->"新游戏密码须6–64位，不含空白，且不能使用常见弱密码。";case "AUTHORITY_OFFLINE","OWNERSHIP_FEED_UNAVAILABLE"->"统一账号服务暂不可用，请稍后重试；没有回退到旧密码。";default->"结果尚未确认；用原请求ID查询，不要重复改密。";};
        say(p,message+" ["+text(result,"requestId")+"]");
        say(p,"MC_SHARED_ACCOUNT "+result);
    }
    private void reject(ServerPlayer p,String reason,boolean retryable,long after){
        String id=UUID.randomUUID().toString();JsonObject r=new JsonObject();r.addProperty("schemaVersion",1);r.addProperty("requestId",id);r.addProperty("state","failed");r.addProperty("reason",reason);r.addProperty("accepted",false);r.addProperty("retryable",retryable);r.addProperty("retryAfterMs",after);r.addProperty("bodyUuid",p.getUUID().toString());
        try{bridge.write(bridge.root.resolve("client-results").resolve(id+".json"),"client-result:"+id,r,false);}catch(Exception unavailable){}receipt(p,r);
    }
    private static void say(ServerPlayer p,String message){p.sendSystemMessage(Component.literal(message));}
}
