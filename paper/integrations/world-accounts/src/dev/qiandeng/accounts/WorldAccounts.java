package dev.qiandeng.accounts;

import com.mojang.brigadier.arguments.StringArgumentType;
import io.github.truscdo.mixauth.AuthServerConfig;
import io.github.truscdo.mixauth.KnownPlayerService;
import io.github.truscdo.mixauth.PasswordPolicyValidator;
import io.github.truscdo.mixauth.offline.OfflineAuthService;
import io.github.truscdo.mixauth.offline.OfflineAuthSessionService;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.storage.LevelResource;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.CommandEvent;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.server.*;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/** Optional server-only mailbox. MixAuth owns authentication and every hash.
 * No HTTP listener, client mod, name-based bypass or automatic body spawning. */
@Mod(value="qiandeng_world_accounts", dist=Dist.DEDICATED_SERVER)
public final class WorldAccounts {
    private volatile MinecraftServer server;
    private volatile AccountMailbox mailbox;
    private volatile boolean started;
    private final Map<UUID,Integer> failures=new ConcurrentHashMap<>();

    public WorldAccounts(IEventBus bus) {
        NeoForge.EVENT_BUS.addListener(this::start);
        NeoForge.EVENT_BUS.addListener(EventPriority.HIGHEST,this::stop);
        NeoForge.EVENT_BUS.addListener(this::tick);
        NeoForge.EVENT_BUS.addListener(this::commands);
        NeoForge.EVENT_BUS.addListener(EventPriority.HIGHEST,this::command);
    }
    private void start(ServerStartedEvent event) {
        Path config=Path.of("config/qiandeng-world-accounts.properties");
        if(!Files.exists(config))return; // absent means disabled, native login is unchanged
        server=event.getServer();
        try {
            Properties settings=new Properties();try(var in=Files.newInputStream(config)){settings.load(in);}
            if(!settings.getProperty("enabled","false").equals("true"))return;
            Path directory=Path.of(settings.getProperty("directory")),keyFile=Path.of(settings.getProperty("keyFile"));
            if(!directory.isAbsolute()||!keyFile.isAbsolute())throw new IllegalArgumentException("absolute paths required");
            String key=Files.readString(keyFile).trim();if(!key.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("key");
            mailbox=new AccountMailbox(directory,HexFormat.of().parseHex(key),new NativeAccounts(),settings.getProperty("serverId"));
            started=true;
        } catch(Exception invalid) {
            // Never print config values, password/hash or decrypted requests.
            System.err.println("[WorldAccounts] 账号桥未启用：配置或加密账本校验失败；原生登录保持。");
        }
    }
    private void tick(ServerTickEvent.Post event){var bridge=mailbox;if(started&&bridge!=null&&event.getServer().getTickCount()%20==0)bridge.tick();}
    private void stop(ServerStoppingEvent event){started=false;var bridge=mailbox;mailbox=null;if(bridge!=null)bridge.close();}
    private void commands(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("portal")
            .then(Commands.literal("bind").then(Commands.argument("request",StringArgumentType.word())
                .then(Commands.argument("code",StringArgumentType.word()).executes(c->{
                    ServerPlayer player=c.getSource().getPlayerOrException();var bridge=mailbox;
                    if(bridge==null){player.sendSystemMessage(Component.literal("网站账号桥尚未启用，请稍后查询原请求。"));return 0;}
                    UUID uuid=player.getUUID();String name=player.getGameProfile().getName();
                    bridge.confirm(StringArgumentType.getString(c,"request"),StringArgumentType.getString(c,"code"),name,uuid,
                        ()->proof(player),message->server.execute(()->{
                            if(server.getPlayerList().getPlayer(uuid)==player)player.sendSystemMessage(Component.literal(message));
                        }));
                    return 1;
                })))));
    }
    private boolean proof(ServerPlayer player) {
        // The mailbox worker asks the actual main-thread session and then checks
        // the native registered hash. A guest or stale player object is no proof.
        try {
            MinecraftServer current=server;UUID uuid=player.getUUID();
            boolean session=current.submit(()->started&&current.getPlayerList().getPlayer(uuid)==player
                &&player.connection!=null&&authenticated(player)).get(3,TimeUnit.SECONDS);
            if(!session||!OfflineAuthService.isOfflineRegistered(uuid))return false;
            for(String weak:List.of("123456","12345678","password","qwerty"))
                if(OfflineAuthService.verifyOfflinePassword(uuid,weak))return false;
            return current.submit(()->started&&current.getPlayerList().getPlayer(uuid)==player
                &&authenticated(player)).get(3,TimeUnit.SECONDS);
        } catch(Exception unavailable){return false;}
    }
    private boolean authenticated(ServerPlayer player) {
        // Reuse the installed FOM join/session gate, including its joining guard.
        // Native pending==null by itself is insufficient during the join event.
        try{return OfflineAuthSessionService.getPendingAuth(player)==null&&(Boolean)Class.forName("dev.qiandeng.maw.PlayerAuthBridge")
            .getMethod("authenticated",ServerPlayer.class).invoke(null,player);}
        catch(ReflectiveOperationException unavailable){return false;}
    }
    private void command(CommandEvent event) {
        var bridge=mailbox;ServerPlayer player=event.getParseResults().getContext().getSource().getPlayer();
        if(bridge==null||player==null||!bridge.isManaged(player.getUUID()))return;
        String input=event.getParseResults().getReader().getString().replaceFirst("^/","").trim().toLowerCase(Locale.ROOT);
        if(input.matches("(?:[a-z0-9_.-]+:)?auth\\s+changepassword(?:\\s.*)?")){
            event.setCanceled(true);player.sendSystemMessage(Component.literal("此角色使用跨世界统一密码，请到网站的世界大厅改密；各服会逐项确认。"));
        }
    }
    private final class NativeAccounts implements AccountMailbox.Accounts {
        public boolean ready(){return started&&server!=null&&!server.isStopped();}
        public boolean reserved(String name){
            if(!AccountMailbox.agentName(name)||Set.of("ag_goddess","ag_live","ag_player","ag_corti","ag_corticam").contains(name.toLowerCase(Locale.ROOT)))return true;
            try{return server.submit(()->Arrays.stream(server.getPlayerList().getOpNames()).anyMatch(n->n.equalsIgnoreCase(name))).get(3,TimeUnit.SECONDS);}
            catch(Exception unavailable){return true;}
        }
        private UUID uuid(String name){return UUID.nameUUIDFromBytes(("OfflinePlayer:"+name).getBytes(StandardCharsets.UTF_8));}
        public AccountMailbox.Identity find(String name) throws Exception {
            var rows=KnownPlayerService.findKnownPlayersByUsername(name);
            if(rows.size()!=1||!rows.getFirst().username().equals(name)||!rows.getFirst().playerUuid().equals(uuid(name)))return null;
            var row=rows.getFirst();return new AccountMailbox.Identity(row.username(),row.playerUuid());
        }
        private boolean online(String name) throws Exception {
            return server.submit(()->server.getPlayerList().getPlayers().stream().anyMatch(p->p.getGameProfile().getName().equalsIgnoreCase(name))).get(3,TimeUnit.SECONDS);
        }
        private void validatePassword(String password) throws AccountMailbox.Problem {
            if(password.length()<8||!PasswordPolicyValidator.validate(password).valid())
                throw new AccountMailbox.Problem("PASSWORD_INVALID","密码不符合此世界的长度要求，请在网站设置至少八位密码");
        }
        public AccountMailbox.Identity create(String name,String password,long createdAt) throws Exception {
            validatePassword(password);if(reserved(name))throw new AccountMailbox.Problem("RESERVED_ACCOUNT","管理身份保留原生认证");UUID id=uuid(name);
            if(!KnownPlayerService.findKnownPlayersByUsername(name).isEmpty()||OfflineAuthService.isOfflineRegistered(id)||Files.exists(server.getWorldPath(LevelResource.PLAYER_DATA_DIR).resolve(id+".dat"))||online(name))
                throw new AccountMailbox.Problem("ACCOUNT_EXISTS","角色已存在，请登录原角色后使用网站认领命令；不能覆盖原账号");
            String hash=OfflineAuthService.hashOfflinePasswordAsync(password).get(30,TimeUnit.SECONDS);
            // Recheck after expensive hashing; insert-only is the final authority.
            if(!KnownPlayerService.findKnownPlayersByUsername(name).isEmpty()||online(name))throw new AccountMailbox.Problem("ACCOUNT_EXISTS","角色已开始登录，请改用原角色认领");
            if(reserved(name))throw new AccountMailbox.Problem("RESERVED_ACCOUNT","身份权限已变化，请联系服主核对");
            if(!OfflineAuthService.insertOfflinePasswordHash(id,hash))throw new AccountMailbox.Problem("ACCOUNT_EXISTS","原密码已存在，没有覆盖");
            OfflineAuthService.recordOfflineLogin(id,name);
            if(!OfflineAuthService.verifyOfflinePassword(id,password))throw new IllegalStateException("write result unavailable");
            return new AccountMailbox.Identity(name,id);
        }
        public AccountMailbox.Identity verify(String name,UUID expected,String password) throws Exception {
            if(reserved(name))throw new AccountMailbox.Problem("RESERVED_ACCOUNT","管理身份保留原生认证");
            var identity=find(name);
            if(identity==null||!identity.uuid().equals(expected)||!OfflineAuthService.isOfflineRegistered(expected))throw new AccountMailbox.Problem("IDENTITY_MISMATCH","原角色身份或密码尚未核实");
            if(OfflineAuthService.getOfflineLoginBlockRemainingMillis(expected)>0)throw new AccountMailbox.Problem("PASSWORD_BLOCKED","原生登录已暂时锁定，请等待后再核对");
            if(password.isEmpty()||password.length()>128||!OfflineAuthService.verifyOfflinePassword(expected,password)){
                if(failures.merge(expected,1,Integer::sum)>=AuthServerConfig.maxLoginAttempts()){
                    OfflineAuthService.blockOfflineLogin(expected,AuthServerConfig.tempBlockMillis());failures.remove(expected);
                }
                throw new AccountMailbox.Problem("PASSWORD_INCORRECT","当前游戏密码不正确");
            }
            failures.remove(expected);return identity;
        }
        public AccountMailbox.Identity password(String name,UUID expected,String previous,String next) throws Exception {
            validatePassword(next);var identity=verify(name,expected,previous);
            String hash=OfflineAuthService.hashOfflinePasswordAsync(next).get(30,TimeUnit.SECONDS);
            verify(name,expected,previous);
            OfflineAuthService.saveOfflinePasswordHash(expected,hash);
            OfflineAuthService.clearTrustedOfflineLogins(expected);
            if(!OfflineAuthService.verifyOfflinePassword(expected,next))throw new IllegalStateException("write result unavailable");
            return identity;
        }
    }
}
