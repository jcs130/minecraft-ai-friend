package dev.qiandeng.maw;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;

import java.lang.reflect.Method;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.Map;
import java.util.HashMap;
import java.util.concurrent.CompletableFuture;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.MessageDigest;
import java.util.HexFormat;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.event.CommandEvent;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;

/** MixAuth remains the password/session authority. Guests have no stored password;
 * verified Xbox identities use a connection nonce and the private Geyser bridge.
 * Neither a player name, IP address nor a client-supplied plugin message is proof. */
public final class PlayerAuthBridge {
    private static final Set<UUID> JOINING = new HashSet<>();
    private static boolean initialized;
    private static boolean enabled;
    private static Method pending;
    private static final Map<UUID, Login> LOGINS = new HashMap<>();
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final class Login {
        final ServerPlayer player;
        final String nonce;
        final long expires = System.currentTimeMillis() + 120_000;
        boolean guest, bedrock, hashing, offline;
        long sent;
        Login(ServerPlayer p) {player=p; byte[] bytes=new byte[32];RANDOM.nextBytes(bytes);nonce=HexFormat.of().formatHex(bytes);}
    }
    private record State(String json) implements CustomPacketPayload {
        static final Type<State> TYPE=new Type<>(ResourceLocation.parse("maw_agent:auth_state"));
        static final StreamCodec<RegistryFriendlyByteBuf,State> CODEC=StreamCodec.of((b,p)->b.writeBytes(p.json.getBytes(StandardCharsets.UTF_8)),b->{
            if(b.readableBytes()>4096)throw new IllegalArgumentException("auth_state_size");byte[] raw=new byte[b.readableBytes()];b.readBytes(raw);return new State(new String(raw,StandardCharsets.UTF_8));});
        public Type<State> type(){return TYPE;}
    }
    private PlayerAuthBridge() {}

    static void register(IEventBus bus) {
        bus.addListener((RegisterPayloadHandlersEvent event) -> event.registrar("1").optional().playToClient(State.TYPE, State.CODEC, (p,c)->{}));
        NeoForge.EVENT_BUS.addListener(EventPriority.HIGHEST, (PlayerEvent.PlayerLoggedInEvent e) -> JOINING.add(e.getEntity().getUUID()));
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, (PlayerEvent.PlayerLoggedInEvent e) -> {
            JOINING.remove(e.getEntity().getUUID());
            if(e.getEntity() instanceof ServerPlayer p){
                // After all normal MixAuth listeners, before any game action can arrive.
                Login login=new Login(p);LOGINS.put(p.getUUID(),login);
                try {
                    Object auth=getPending(p);
                    login.offline=auth!=null;
                    if(auth!=null&&auth.getClass().getMethod("stage").invoke(auth).toString().equals("REGISTER")&&!reserved(p)){
                        release(p);login.guest=true;
                        p.sendSystemMessage(Component.literal("本账号尚未设置登录密码，已允许进入游玩。可用 /password 新密码 再输一次 设置（至少8字符）；未设置时每次登录提醒。模型 API Key 是另一项配置。"));
                    }
                }catch(ReflectiveOperationException|RuntimeException failure){p.connection.disconnect(Component.literal("登录策略暂不可用，请稍后重连。"));}
            }
        });
        NeoForge.EVENT_BUS.addListener((PlayerEvent.PlayerLoggedOutEvent e) -> {JOINING.remove(e.getEntity().getUUID());LOGINS.remove(e.getEntity().getUUID());});
        NeoForge.EVENT_BUS.addListener(PlayerAuthBridge::tick);
        NeoForge.EVENT_BUS.addListener(PlayerAuthBridge::commands);
        NeoForge.EVENT_BUS.addListener(EventPriority.HIGHEST, PlayerAuthBridge::command);
    }

    private static Object service(String name,String method,Class<?>[] types,Object... args)throws ReflectiveOperationException {
        return Class.forName("io.github.truscdo.mixauth."+name).getMethod(method,types).invoke(null,args);
    }
    private static Object getPending(ServerPlayer p)throws ReflectiveOperationException {
        return net.neoforged.fml.ModList.get().isLoaded("mixauth")?service("offline.OfflineAuthSessionService","getPendingAuth",new Class<?>[]{ServerPlayer.class},p):null;
    }
    private static boolean registered(ServerPlayer p)throws ReflectiveOperationException {
        return (Boolean)service("offline.OfflineAuthService","isOfflineRegistered",new Class<?>[]{UUID.class},p.getUUID());
    }
    private static void release(ServerPlayer p)throws ReflectiveOperationException {
        if(getPending(p)!=null)service("offline.OfflineAuthSessionService","clearPendingAuth",new Class<?>[]{ServerPlayer.class},p);
        p.inventoryMenu.sendAllDataToRemote();
    }
    private static Path identities(ServerPlayer p) {
        return p.getServer().getServerDirectory().resolve("config/maw-login-private/bedrock-identities.json");
    }
    private static JsonObject identitiesRead(ServerPlayer p) {
        try {Path f=identities(p);return Files.exists(f)?JsonParser.parseString(Files.readString(f,StandardCharsets.UTF_8)).getAsJsonObject():new JsonObject();}
        catch(Exception e){throw new IllegalStateException("bedrock_identity_store_unavailable",e);}
    }
    private static boolean reserved(ServerPlayer p) {return identitiesRead(p).has(p.getUUID().toString());}

    /** Called only behind HeadlessHttp's loopback + X-Maw-Bridge authentication.
     * Nonce arrived on the exact Java connection, not via an HTTP name lookup. */
    public static JsonObject authenticateBedrock(ServerPlayer p,JsonObject args) {
        Login login=LOGINS.get(p.getUUID());
        if(login==null||login.player!=p||System.currentTimeMillis()>login.expires||!args.keySet().equals(Set.of("nonce","xuid")))throw new IllegalArgumentException("bedrock_login_challenge_expired");
        String nonce=args.get("nonce").getAsString(),xuid=args.get("xuid").getAsString();
        if(!nonce.matches("[a-f0-9]{64}")||!MessageDigest.isEqual(nonce.getBytes(StandardCharsets.US_ASCII),login.nonce.getBytes(StandardCharsets.US_ASCII))||!xuid.matches("[1-9][0-9]{5,19}"))throw new IllegalArgumentException("bedrock_login_proof_invalid");
        try {
            JsonObject all=identitiesRead(p);String id=p.getUUID().toString();
            if(all.has(id)&&!all.get(id).getAsString().equals(xuid))throw new IllegalArgumentException("bedrock_identity_conflict");
            if(!all.has(id)&&registered(p)&&!authenticated(p))throw new IllegalArgumentException("bedrock_existing_password_required_once");
            for(var row:all.entrySet())if(!row.getKey().equals(id)&&row.getValue().getAsString().equals(xuid))throw new IllegalArgumentException("bedrock_identity_rename_requires_operator_link");
            if(!all.has(id)){
                all.addProperty(id,xuid);Path f=identities(p);Files.createDirectories(f.getParent());Path temp=Files.createTempFile(f.getParent(),"identities-",".tmp");
                try {Files.writeString(temp,all.toString(),StandardCharsets.UTF_8);Files.move(temp,f,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}
                finally {Files.deleteIfExists(temp);}
            }
            release(p);login.bedrock=true;login.guest=false;
            JsonObject out=new JsonObject();out.addProperty("ok",true);out.addProperty("mode","verified_bedrock");out.addProperty("playerUuid",id);return out;
        }catch(ReflectiveOperationException|java.io.IOException e){throw new IllegalStateException("bedrock_authentication_unavailable",e);}
    }
    private static void tick(ServerTickEvent.Post event) {
        if(event.getServer().getTickCount()%20!=0)return;
        long now=System.currentTimeMillis();
        for(Login login:LOGINS.values()){
            ServerPlayer p=login.player;
            if(login.bedrock||p.connection==null||now>login.expires||now-login.sent<2000||!p.connection.hasChannel(State.TYPE))continue;
            login.sent=now;JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("playerUuid",p.getUUID().toString());out.addProperty("nonce",login.nonce);out.addProperty("expiresAt",login.expires);
            PacketDistributor.sendToPlayer(p,new State(out.toString()));
        }
    }
    private static void commands(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("password").requires(s->s.getEntity() instanceof ServerPlayer)
            .then(Commands.argument("password",StringArgumentType.word()).then(Commands.argument("confirm",StringArgumentType.word()).executes(c->password(c.getSource().getPlayerOrException(),StringArgumentType.getString(c,"password"),StringArgumentType.getString(c,"confirm"))))));
    }
    private static void command(CommandEvent e) {
        if(!(e.getParseResults().getContext().getSource().getEntity() instanceof ServerPlayer p))return;
        String[] parts=e.getParseResults().getReader().getString().strip().replaceFirst("^/","").split("\\s+");
        if(parts.length==0)return;
        if(reserved(p)&&((!authenticated(p)&&Set.of("register","login","password").contains(parts[0]))||Set.of("register","password").contains(parts[0]))){
            e.setCanceled(true);p.sendSystemMessage(Component.literal("这是已绑定 Xbox 的账号，请使用对应基岩账号登录。"));return;
        }
        Login login=LOGINS.get(p.getUUID());
        if(parts[0].equals("register")&&login!=null&&login.player==p&&login.guest){
            e.setCanceled(true);if(parts.length==3)password(p,parts[1],parts[2]);else p.sendSystemMessage(Component.literal("用法：/password 新密码 再输一次"));
        }
    }
    @SuppressWarnings("unchecked")
    private static int password(ServerPlayer p,String password,String confirm) {
        Login login=LOGINS.get(p.getUUID());
        if(login==null||login.player!=p||!authenticated(p))return 0;
        if(!login.offline){p.sendSystemMessage(Component.literal("正版账号已验证身份，无需设置游戏登录密码。"));return 0;}
        if(login.bedrock||reserved(p)){p.sendSystemMessage(Component.literal("基岩正版账号使用 Xbox 验证，无需设置游戏登录密码。"));return 0;}
        if(login.hashing){p.sendSystemMessage(Component.literal("密码正在保存，请稍候。"));return 0;}
        try {
            if(!(Boolean)service("command.CommandSupport","validatePasswordPair",new Class<?>[]{net.minecraft.commands.CommandSourceStack.class,String.class,String.class},p.createCommandSourceStack(),password,confirm))return 0;
            boolean existing=registered(p);login.hashing=true;
            CompletableFuture<String> work=(CompletableFuture<String>)service("offline.OfflineAuthService","hashOfflinePasswordAsync",new Class<?>[]{String.class},password);
            work.whenComplete((hash,error)->p.getServer().execute(()->{
                login.hashing=false;
                if(LOGINS.get(p.getUUID())!=login||!authenticated(p))return;
                try {
                    if(error!=null)throw new IllegalStateException("password_hash_failed");
                    if(existing){service("offline.OfflineAuthService","saveOfflinePasswordHash",new Class<?>[]{UUID.class,String.class},p.getUUID(),hash);service("offline.OfflineAuthService","clearTrustedOfflineLogins",new Class<?>[]{UUID.class},p.getUUID());}
                    else if(!(Boolean)service("offline.OfflineAuthService","insertOfflinePasswordHash",new Class<?>[]{UUID.class,String.class},p.getUUID(),hash))throw new IllegalStateException("password_already_registered");
                    login.guest=false;p.sendSystemMessage(Component.literal("登录密码已保存。下次离线登录请用 /login 你的密码。"));
                }catch(Exception failed){p.sendSystemMessage(Component.literal("密码未能保存，请重新登录确认后再设置。"));}
            }));return 1;
        }catch(ReflectiveOperationException failed){login.hashing=false;p.sendSystemMessage(Component.literal("密码服务暂不可用，请稍后重试。"));return 0;}
    }

    public static boolean authenticated(ServerPlayer player) {
        if (!initialized) {
            enabled = net.neoforged.fml.ModList.get().isLoaded("mixauth");
            if (enabled) {
                try { pending = Class.forName("io.github.truscdo.mixauth.offline.OfflineAuthSessionService").getMethod("getPendingAuth", ServerPlayer.class); }
                catch (ReflectiveOperationException unavailable) { pending = null; }
            }
            initialized = true;
        }
        if (!enabled) return true;
        if (player.connection == null || JOINING.contains(player.getUUID()) || pending == null) return false;
        try { return pending.invoke(null, player) == null; }
        catch (ReflectiveOperationException failure) { return false; }
    }

    public static void requireAuthenticated(ServerPlayer player) {
        if (!authenticated(player)) throw new IllegalArgumentException("authentication_required");
    }

    static JsonObject denial(ServerPlayer player, String raw, String kind) {
        if (authenticated(player)) return null;
        JsonObject out = new JsonObject();
        out.addProperty("schemaVersion", 1); out.addProperty("kind", kind);
        out.addProperty("playerUuid", player.getUUID().toString());
        out.addProperty("ok", false); out.addProperty("code", "authentication_required");
        out.addProperty("outcomeKnown", true); out.addProperty("changed", false);
        out.addProperty("retryAutomatically", false);
        try {
            JsonObject in = JsonParser.parseString(raw).getAsJsonObject();
            String id = in.get("requestId").getAsString();
            if (id.matches("[A-Za-z0-9:_-]{1,64}")) out.addProperty("requestId", id);
            if (in.has("kind")) out.addProperty("action", in.get("kind").getAsString());
        } catch (RuntimeException ignored) { /* Never inspect world data before authentication. */ }
        return out;
    }
}
