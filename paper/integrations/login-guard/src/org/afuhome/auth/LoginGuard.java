package org.afuhome.auth;

import com.google.inject.Inject;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.velocitypowered.api.event.PostOrder;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.proxy.ProxyShutdownEvent;
import com.velocitypowered.api.event.connection.PreLoginEvent;
import com.velocitypowered.api.event.connection.PostLoginEvent;
import com.velocitypowered.api.event.connection.DisconnectEvent;
import com.velocitypowered.proxy.connection.client.ConnectedPlayer;
import com.velocitypowered.proxy.protocol.StateRegistry;
import com.velocitypowered.proxy.protocol.netty.MinecraftDecoder;
import io.netty.buffer.ByteBuf;
import io.netty.channel.*;
import io.netty.util.ReferenceCountUtil;
import com.velocitypowered.api.event.command.CommandExecuteEvent;
import com.velocitypowered.api.event.player.PlayerChatEvent;
import com.velocitypowered.api.event.player.ServerPreConnectEvent;
import com.velocitypowered.api.event.player.ServerPostConnectEvent;
import com.velocitypowered.api.event.player.GameProfileRequestEvent;
import com.velocitypowered.api.event.connection.PluginMessageEvent;
import com.velocitypowered.api.proxy.messages.MinecraftChannelIdentifier;
import com.github.retrooper.packetevents.PacketEvents;
import com.github.retrooper.packetevents.event.*;
import com.github.retrooper.packetevents.protocol.packettype.PacketType;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.command.SimpleCommand;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import net.kyori.adventure.text.Component;
import org.slf4j.Logger;
import xyz.kyngs.librelogin.api.LibreLoginPlugin;
import xyz.kyngs.librelogin.api.provider.LibreLoginProvider;

import java.nio.file.*;
import java.io.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.net.SocketAddress;
import xyz.kyngs.librelogin.api.event.events.AuthenticatedEvent.AuthenticationReason;

/** Fail closed when LibreLogin cannot initialize; keep reconnects from resetting
 * the wrong-password counter. No passwords or TOTP secrets are logged here. */
public final class LoginGuard {
    private final ProxyServer server;
    private final Logger logger;
    private final Gson gson = new com.google.gson.GsonBuilder().serializeNulls().create();
    private LibreLoginPlugin<Player, RegisteredServer> libre;
    private Path heartbeat, attemptsFile, opsFile, eyesFile;
    private volatile EyePolicy eyes;
    private PortalBridge portal;
    private final Properties attempts = new Properties();
    private volatile boolean ready;
    private volatile Set<String> reserved = Set.of("corti", "corticam", "player", "goddess");
    private boolean hooked;
    private final Set<Player> authenticated=ConcurrentHashMap.newKeySet();
    private final Set<Player> verifiedAdminPassword=ConcurrentHashMap.newKeySet();
    private final Map<SocketAddress,UUID> premiumProofs=new ConcurrentHashMap<>();
    private final Map<Player,UUID> eyeSessions=new ConcurrentHashMap<>();
    private final Set<Player> firstPasswordSessions=ConcurrentHashMap.newKeySet();
    private final Set<UUID> passwordWrites=ConcurrentHashMap.newKeySet();
    private final Map<Player,Long> passwordReminders=new ConcurrentHashMap<>();
    private final Map<Player,String> observationSessions=new ConcurrentHashMap<>();
    private final Map<Player,String> authenticationMethods=new ConcurrentHashMap<>();
    private final Set<Player> authenticationNotified=ConcurrentHashMap.newKeySet();
    private static final MinecraftChannelIdentifier AGENT_CHANNEL=MinecraftChannelIdentifier.create("qiandengji","agent");
    private static final MinecraftChannelIdentifier MCBOT_CHANNEL=MinecraftChannelIdentifier.create("mcbot","c2s");
    private static final MinecraftChannelIdentifier VOICE_CHANNEL=MinecraftChannelIdentifier.create("mcagent","voice");
    private final Set<Player> payloadPeers=ConcurrentHashMap.newKeySet();
    private final Map<String,Long> diagnosticTimes=new ConcurrentHashMap<>();

    @Inject public LoginGuard(ProxyServer server, Logger logger) { this.server=server; this.logger=logger; }
    private static String key(String name) { return name.toLowerCase(Locale.ROOT); }
    private static Component text(String s) { return Component.text(s); }
    private boolean authorized(Player p) {
        try {
            UUID body=eyeSessions.get(p);
            if(body!=null && server.getPlayer(body).filter(b->inPaper(b)&&authorized(b)).isEmpty())return false;
            return ready && authenticated.contains(p) && libre.getAuthorizationProvider().isAuthorized(p)
                && !libre.getAuthorizationProvider().isAwaiting2FA(p);
        }
        catch (Exception e) { ready=false; diagnostic("authorization_provider",e); return false; }
    }
    // Log categories, never submitted arguments, credentials or database rows.
    private void diagnostic(String phase,Throwable failure) {
        long now=System.currentTimeMillis();
        Long previous=diagnosticTimes.putIfAbsent(phase,now);
        if(previous!=null && (now-previous<10_000 || !diagnosticTimes.replace(phase,previous,now)))return;
        if(logger!=null)logger.warn("MC_AUTH_SERVICE_ERROR phase={} exception={}",phase,failure.getClass().getSimpleName());
    }
    @Subscribe(order=PostOrder.LAST) public void start(ProxyInitializeEvent event) throws Exception {
        server.getChannelRegistrar().register(AGENT_CHANNEL);
        server.getChannelRegistrar().register(MCBOT_CHANNEL);
        server.getChannelRegistrar().register(VOICE_CHANNEL);
        var cfg = new Properties();
        try (var in=Files.newInputStream(Path.of("plugins/login-guard/config.properties"))) { cfg.load(in); }
        heartbeat=Path.of(cfg.getProperty("heartbeat"));
        attemptsFile=Path.of(cfg.getProperty("attempts"));
        opsFile=Path.of(cfg.getProperty("ops"));
        if(cfg.getProperty("eyes")!=null)eyesFile=Path.of(cfg.getProperty("eyes"));
        if (Files.exists(attemptsFile)) try(var in=Files.newInputStream(attemptsFile)) { attempts.load(in); }
        // NanoLimbo 1.0.11 omits select_known_packs. minecraft-protocol leaves
        // its once-listener pending and replies twice when switching to Paper.
        // Forward one response per real request; do not alter registry contents.
        var packs=Collections.synchronizedMap(new WeakHashMap<Object,Boolean>());
        PacketEvents.getAPI().getEventManager().registerListener(new PacketListenerAbstract(PacketListenerPriority.HIGHEST) {
            @Override public void onPacketSend(PacketSendEvent e) {
                if(e.getPacketType()==PacketType.Configuration.Server.SELECT_KNOWN_PACKS) packs.put(e.getUser(),true);
            }
            @Override public void onPacketReceive(PacketReceiveEvent e) {
                if(e.getPacketType()==PacketType.Configuration.Client.SELECT_KNOWN_PACKS) {
                    if(!Boolean.TRUE.equals(packs.remove(e.getUser()))) e.setCancelled(true);
                }
            }
        });
        server.getScheduler().buildTask(this, this::refresh).repeat(Duration.ofSeconds(1)).schedule();
        refresh();
        server.getCommandManager().register(server.getCommandManager().metaBuilder("portal").plugin(this).build(),new SimpleCommand(){
            @Override public void execute(Invocation invocation) {
                if(!(invocation.source() instanceof Player player))return;
                portalCommand(player,invocation.arguments());
            }
        });
        if(Boolean.parseBoolean(cfg.getProperty("portal.enabled","false"))) {
            try {
                Path directory=Path.of(cfg.getProperty("portal.directory"));
                String encoded=Files.readString(Path.of(cfg.getProperty("portal.key-file"))).trim();
                if(!encoded.matches("[a-fA-F0-9]{64}"))throw new IllegalArgumentException("portal key");
                portal=new PortalBridge(directory,HexFormat.of().parseHex(encoded),new PortalBridge.Accounts(){
                    public boolean ready(){return LoginGuard.this.ready;}
                    public boolean reserved(String name){return portalReserved(name);}
                    public PortalBridge.Identity find(String name){var user=libre.getDatabaseProvider().getByName(name);return user==null?null:new PortalBridge.Identity(user.getLastNickname(),user.getUuid());}
                    public PortalBridge.Identity create(String name,String password,long createdAt) throws Exception {return portalCreate(name,password,createdAt);}
                    public PortalBridge.Identity password(String name,UUID uuid,String previous,String next) throws Exception {return portalPassword(name,uuid,previous,next);}
                    public PortalBridge.Identity verify(String name,UUID uuid,String password) throws Exception {return portalVerify(name,uuid,password);}
                });
                server.getScheduler().buildTask(this,portal::tick).repeat(Duration.ofSeconds(1)).schedule();
            } catch(Exception unavailable){logger.warn("Optional portal account bridge unavailable; existing game authentication remains unchanged.");}
        }
    }
    private boolean portalReserved(String name) {
        return reserved.contains(key(name))||key(name).equals("live")||key(name).endsWith("eye")
            ||(eyes!=null&&eyes.body(name,reserved)!=null);
    }
    private void portalCommand(Player player,String[] parts) {
        if(portal==null){player.sendMessage(text("网站绑定服务尚未启用，请联系服主。"));return;}
        if(parts.length!=3||!parts[0].equals("bind")){player.sendMessage(text("请登录网站，复制本人角色的 /portal bind 完整命令。"));return;}
        if(!authorized(player)){player.sendMessage(text("先 /login 完成登录，再绑定网站账号。"));return;}
        portal.confirm(parts[1],parts[2],player.getUsername(),player.getUniqueId(),()->portalProof(player),message->player.sendMessage(text(message)));
    }
    private boolean portalWorldNameExists(String name) throws Exception {
        Path cache=opsFile.getParent().resolve("usercache.json");
        if(!Files.isRegularFile(cache)||Files.size(cache)>2*1024*1024)throw new IllegalStateException("world identity cache unavailable");
        var rows=gson.fromJson(Files.readString(cache),com.google.gson.JsonArray.class);
        if(rows==null)throw new IllegalStateException("world identity cache invalid");
        for(var element:rows){var row=element.getAsJsonObject();if(row.has("name")&&row.get("name").getAsString().equalsIgnoreCase(name))return true;}
        return false;
    }
    private PortalBridge.Identity portalCreate(String name,String password,long createdAt) throws Exception {
        if(!ready||portalReserved(name)||!PortalBridge.agentName(name))throw new PortalBridge.Problem("RESERVED_ACCOUNT","此名称不可从网站注册");
        if(!libre.validPassword(password))throw new PortalBridge.Problem("PASSWORD_INVALID","游戏密码未通过服务器校验");
        UUID uuid=UUID.nameUUIDFromBytes(("OfflinePlayer:"+name).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        // Never claim a pre-existing world character, even if its login record
        // is absent. Current production has whitelist=false; no OP is granted.
        Path world=opsFile.getParent().resolve("world/playerdata").resolve(uuid+".dat");
        if(libre.getDatabaseProvider().getByName(name)!=null||libre.getDatabaseProvider().getByUUID(uuid)!=null||Files.exists(world)||portalWorldNameExists(name))throw new PortalBridge.Problem("ACCOUNT_EXISTS","原角色已经存在，请在游戏内绑定，不能覆盖");
        var hash=libre.getDefaultCryptoProvider().createHash(password);
        if(hash==null)throw new PortalBridge.Problem("PASSWORD_INVALID","游戏密码暂不支持此长度");
        if(libre.getDatabaseProvider().getByName(name)!=null||server.getPlayer(name).isPresent()||portalWorldNameExists(name))throw new PortalBridge.Problem("ACCOUNT_EXISTS","该名称已开始登录，请先核对原角色");
        var date=new java.sql.Timestamp(createdAt);
        var user=libre.createUser(uuid,null,hash,name,date,date,null,null,null,null,null);
        libre.getDatabaseProvider().insertUser(user);
        var saved=libre.getDatabaseProvider().getByName(name);
        if(saved==null||!saved.getUuid().equals(uuid)||!saved.isRegistered())throw new IllegalStateException("portal account persistence unavailable");
        return new PortalBridge.Identity(saved.getLastNickname(),saved.getUuid());
    }
    private final Map<UUID,long[]> portalFailures=new ConcurrentHashMap<>();
    private PortalBridge.Identity portalVerify(String name,UUID expected,String password) throws Exception {
        if(!ready||portalReserved(name))throw new PortalBridge.Problem("RESERVED_ACCOUNT","此身份保留原游戏认证");
        var user=libre.getDatabaseProvider().getByName(name);
        if(user==null||!user.getLastNickname().equals(name)||!user.getUuid().equals(expected)||!user.isRegistered())throw new PortalBridge.Problem("IDENTITY_MISMATCH","原账号身份或密码状态未核实");
        if(user.getSecret()!=null)throw new PortalBridge.Problem("TOTP_IN_GAME","两步验证账号请保留原游戏认证");
        long now=System.currentTimeMillis();var counter=portalFailures.computeIfAbsent(expected,u->new long[]{now,0});
        synchronized(counter){
            if(now-counter[0]>300000){counter[0]=now;counter[1]=0;}
            if(counter[1]>=3)throw new PortalBridge.Problem("PASSWORD_BLOCKED","网页密码核对次数过多，请五分钟后再试");
            if(password==null||password.isEmpty()||password.length()>128||!libre.getCryptoProvider(user.getHashedPassword().algo()).matches(password,user.getHashedPassword())){
                counter[1]++;throw new PortalBridge.Problem("PASSWORD_INCORRECT","当前游戏密码不正确");
            }
            counter[1]=0;
        }
        return new PortalBridge.Identity(user.getLastNickname(),user.getUuid());
    }
    private PortalBridge.Identity portalPassword(String name,UUID expected,String previous,String next) throws Exception {
        if(!ready||portalReserved(name))throw new PortalBridge.Problem("RESERVED_ACCOUNT","此账号请在游戏内改密");
        portalVerify(name,expected,previous);
        var user=libre.getDatabaseProvider().getByName(name);
        if(user==null||!user.getUuid().equals(expected)||!user.isRegistered())throw new PortalBridge.Problem("IDENTITY_MISMATCH","原账号身份或密码状态未核实");
        if(user.getSecret()!=null)throw new PortalBridge.Problem("TOTP_IN_GAME","两步验证账号请在游戏内 /changepassword 改密");
        if(!libre.validPassword(next)||!libre.getCryptoProvider(user.getHashedPassword().algo()).matches(previous,user.getHashedPassword()))throw new PortalBridge.Problem("PASSWORD_INCORRECT","当前游戏密码不正确，或新密码不符合要求");
        if(!passwordWrites.add(expected))throw new PortalBridge.Problem("PASSWORD_BUSY","另一项密码操作尚未结束，请先查询结果");
        try {
            var hash=libre.getDefaultCryptoProvider().createHash(next);
            if(hash==null)throw new PortalBridge.Problem("PASSWORD_INVALID","新密码暂不支持此长度");
            synchronized(user) {
                if(!libre.getCryptoProvider(user.getHashedPassword().algo()).matches(previous,user.getHashedPassword()))throw new PortalBridge.Problem("PASSWORD_CHANGED","密码状态已变化，请先重新核对");
                var old=user.getHashedPassword();
                try {user.setHashedPassword(hash);libre.getDatabaseProvider().updateUser(user);}
                catch(Exception failure){user.setHashedPassword(old);throw failure;}
            }
            return new PortalBridge.Identity(user.getLastNickname(),user.getUuid());
        } finally {passwordWrites.remove(expected);}
    }
    private boolean portalProof(Player p) {
        if(!ready||!authorized(p)||!inPaper(p)||portalReserved(p.getUsername())||!server.getPlayer(p.getUniqueId()).filter(current->current==p).isPresent())return false;
        var user=libre.getDatabaseProvider().getByName(p.getUsername());
        if(user==null||!user.getUuid().equals(p.getUniqueId()))return false;
        if(premiumVerified(p,user.getPremiumUUID()))return true;
        if(!user.isRegistered()||firstPasswordSessions.contains(p))return false;
        var crypto=libre.getCryptoProvider(user.getHashedPassword().algo());
        for(String weak:List.of("123456","12345678","password","qwerty"))if(crypto.matches(weak,user.getHashedPassword()))return false;
        return authorized(p)&&inPaper(p)&&server.getPlayer(p.getUniqueId()).filter(current->current==p).isPresent();
    }
    // Velocity can run the first scheduled refresh alongside initialization.
    // Serialize it so the authentication listener and atomic heartbeat writer
    // are installed once even on a cold, busy server.
    @SuppressWarnings("unchecked") private synchronized void refresh() {
        try {
            var names=new HashSet<>(List.of("corti","corticam","player","goddess"));
            for (var row : gson.fromJson(Files.readString(opsFile), List.class)) {
                Object name=((Map<?,?>)row).get("name"); if(name instanceof String n) names.add(key(n));
            }
            reserved=Set.copyOf(names);
            if(eyesFile!=null)eyes=new EyePolicy(Files.readString(eyesFile));
            if(libre==null) {
                Object instance=server.getPluginManager().getPlugin("librelogin").flatMap(p->p.getInstance()).orElseThrow();
                libre=((LibreLoginProvider<Player,RegisteredServer>)instance).getLibreLogin();
            }
            ready=libre.getDatabaseProvider()!=null && libre.getAuthorizationProvider()!=null
                && libre.getDefaultCryptoProvider()!=null && server.getServer("auth").filter(s -> {
                    var a=s.getServerInfo().getAddress().getAddress();
                    return a!=null && a.isLoopbackAddress();
                }).isPresent()
                && server.getCommandManager().hasCommand("login");
            if(ready) {
                // The owner permits official premium sessions, including OPs.
                // Offline administrators still need their independent password.
                for(String n:reserved) {
                    var u=libre.getDatabaseProvider().getByName(n);
                    if(u==null || (!u.isRegistered() && u.getPremiumUUID()==null)) { ready=false; break; }
                }
            }
            if(ready && !hooked) {
                libre.getEventProvider().subscribe(libre.getEventProvider().getTypes().authenticated,e->{
                    Player p=e.getPlayer(); if(p==null) return;
                    if(e.getReason()==AuthenticationReason.PREMIUM && !premiumVerified(p,e.getUser()==null?null:e.getUser().getPremiumUUID())) {
                        p.disconnect(text("正版身份验证未通过，请使用本人正版启动器重新连接。[MC_AUTH_DENIED]"));return;
                    }
                    String eyeBody=eyes==null?null:eyes.body(p.getUsername(),reserved);
                    if(eyeBody!=null) {
                        Player body=server.getPlayer(eyeBody).filter(b->inPaper(b)&&authorized(b)).orElse(null);
                        if(body==null){p.disconnect(text("对应本体尚未登录，请先登录本体再连接观战账号。[MC_AUTH_EYE_WAIT]"));return;}
                        eyeSessions.put(p,body.getUniqueId());
                    }
                    if(reserved.contains(key(p.getUsername()))) {
                        boolean proof=verifiedAdminPassword.remove(p);
                        if(e.getReason()!=AuthenticationReason.PREMIUM && (e.getReason()!=AuthenticationReason.LOGIN || !proof)) {
                            logger.warn("Reserved authentication rejected: account={}, reason={}, passwordProof={}, previouslyAuthorized={}",
                                p.getUsername(),e.getReason(),proof,authenticated.contains(p));
                            p.disconnect(text("房管请使用已验证正版账号，或本人独立密码登录。"));return;
                        }
                    }
                    authenticated.add(p);authenticationMethods.put(p,e.getReason().name().toLowerCase(Locale.ROOT));
                });
                libre.getEventProvider().subscribe(libre.getEventProvider().getTypes().wrongPassword,e->{
                    if(e.getPlayer()!=null) wrong(e.getPlayer());
                });
                libre.getEventProvider().subscribe(libre.getEventProvider().getTypes().premiumLoginSwitch,e->{
                    if(e.getPlayer()!=null)verifiedAdminPassword.remove(e.getPlayer());
                });
                hooked=true;
            }
            if(ready) {
                refreshEyes(); refreshFirstPasswords();
                // ServerPostConnect can precede completion of a bootstrap/Eye
                // authorization or overlap a transient unavailable observation.
                // Deliver the old success marker once when BOTH facts are true.
                // This observes authorization; it never grants or retries login.
                server.getAllPlayers().forEach(this::notifyAuthenticated);
            }
        } catch(Throwable e) { ready=false; diagnostic("refresh",e); }
        publishHeartbeat();
    }
    synchronized void publishHeartbeat() {
        if(heartbeat!=null) try {
            var names=server.getAllPlayers().stream().filter(this::authorized).map(Player::getUsername).toList();
            var tmp=Path.of(heartbeat+".tmp"); Files.createDirectories(heartbeat.getParent());
            var observations=server.getAllPlayers().stream().map(this::authenticationState).toList();
            AtomicHeartbeatSnapshot.write(heartbeat,gson.toJson(Map.of("ready",ready,"at",System.currentTimeMillis(),"authorizedNames",names,"sessionStates",observations)));
        } catch(Exception e) {
            // A read-side observation failing to reach disk cannot revoke a
            // live LibreLogin session. Existing commands still check the real
            // provider. The gateway independently rejects NEW connections once
            // the last successful heartbeat expires; no stale grant is added.
            diagnostic("heartbeat_publish",e);
        }
    }
    JsonObject authenticationState(Player p) {
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("source","login_guard");
        out.addProperty("playerUuid",p.getUniqueId().toString());
        out.addProperty("authSessionId",observationSessions.computeIfAbsent(p,ignored->UUID.randomUUID().toString()));
        out.addProperty("observedAt",System.currentTimeMillis());out.addProperty("readOnly",true);
        boolean availableBefore=ready,granted=authorized(p),available=availableBefore&&ready;
        out.addProperty("status",!available?"unavailable":granted?"authenticated":"pending");
        out.add("authorized",available?new com.google.gson.JsonPrimitive(granted):com.google.gson.JsonNull.INSTANCE);out.addProperty("method",authenticationMethods.getOrDefault(p,"unknown"));
        try{var user=libre.getDatabaseProvider().getByName(p.getUsername());
            out.add("passwordSet",user==null?com.google.gson.JsonNull.INSTANCE:new com.google.gson.JsonPrimitive(user.isRegistered()));}
        catch(Exception unavailable){out.add("passwordSet",com.google.gson.JsonNull.INSTANCE);}
        out.addProperty("nextCommand",granted?"/mycli status":"/authstatus");return out;
    }
    private void publishAuthentication(Player p) {
        if(!p.isActive())return;
        JsonObject out=authenticationState(p);
        sendAuthentication(p,out,true);
    }
    private void sendAuthentication(Player p,JsonObject state,boolean explicit) {
        if(AuthMessages.agent(p.getUsername()) && payloadPeers.contains(p)) {
            if(p.sendPluginMessage(AGENT_CHANNEL,AuthMessages.payload(state)))return;
        }
        if(explicit || AuthMessages.agent(p.getUsername()))
            p.sendMessage(text("MC_AUTH_STATE "+(explicit?state:AuthMessages.compact(state))));
    }
    @Subscribe public void agentTransport(PluginMessageEvent e) {
        // Client-selected presentation only. Leave forwarding intact so Paper
        // receives the same hello; server-originated packets cannot opt in a player.
        if(e.getIdentifier().equals(AGENT_CHANNEL) && e.getSource() instanceof Player p
                && AuthMessages.agent(p.getUsername()) && AuthMessages.hello(e.getData()))payloadPeers.add(p);
    }
    @Subscribe(order=PostOrder.FIRST) public void voiceTransport(PluginMessageEvent e) {
        if(!e.getIdentifier().equals(VOICE_CHANNEL))return;
        if(!(e.getSource() instanceof Player p)||!inPaper(p)||!authorized(p)
                ||p.getCurrentServer().filter(c->c==e.getTarget()).isEmpty())
            e.setResult(PluginMessageEvent.ForwardResult.handled());
    }
    @Subscribe(order=PostOrder.FIRST) public void mcbotTransport(PluginMessageEvent e) {
        if(!e.getIdentifier().equals(MCBOT_CHANNEL))return;
        // A game-client driver is a gameplay action, not a new authentication
        // method. Consult the live provider; disk heartbeats cannot grant it.
        if(!(e.getSource() instanceof Player p)||!inPaper(p)||!authorized(p)
                ||p.getCurrentServer().filter(c->c==e.getTarget()).isEmpty())
            e.setResult(PluginMessageEvent.ForwardResult.handled());
    }
    private void notifyAuthenticated(Player p) {
        if(!p.isActive() || !inPaper(p))return;
        JsonObject state=authenticationState(p);
        if(!state.get("status").getAsString().equals("authenticated")
                || !state.get("authorized").getAsBoolean() || !authenticationNotified.add(p))return;
        p.sendMessage(text("[MC_AUTH_SUCCESS] 登录成功，可以开始游戏。"));
        sendAuthentication(p,state,false);
        if(logger!=null)logger.info("MC_AUTH_CONFIRMED account={} backend=paper",p.getUsername());
    }
    private static boolean inPaper(Player p) {
        return p.getCurrentServer().filter(c->c.getServerInfo().getName().equals("paper")).isPresent();
    }
    // Capture the official profile before LibreLogin replaces its UUID with the
    // existing offline storage UUID. isOnlineMode alone is not the stored ID.
    @Subscribe(order=PostOrder.FIRST) public void premiumProfile(GameProfileRequestEvent e) {
        if(e.isOnlineMode() && e.getOriginalProfile()!=null)
            premiumProofs.put(e.getConnection().getRemoteAddress(),e.getOriginalProfile().getId());
    }
    private boolean premiumVerified(Player p,UUID premium) {
        return p.isOnlineMode() && premium!=null && premium.equals(premiumProofs.get(p.getRemoteAddress()));
    }
    /** Owner's first-visit policy: ordinary accounts start without a preset
     * password and may enter before choosing their own. Existing passwords,
     * reserved administrators, TOTP and paired observers are never reset here.
     * Until a first password is chosen, a name is not protected from reuse.
     */
    private void refreshFirstPasswords() {
        for(Player p:server.getAllPlayers()) {
            if(reserved.contains(key(p.getUsername())) || (eyes!=null && eyes.body(p.getUsername(),reserved)!=null))continue;
            var user=libre.getDatabaseProvider().getByName(p.getUsername());
            if(user==null || user.isRegistered() || user.getSecret()!=null)continue;
            if(!authorized(p) && p.getCurrentServer().filter(c->c.getServerInfo().getName().equals("auth")).isPresent()) {
                firstPasswordSessions.add(p);
                libre.getAuthorizationProvider().authorize(user,p,AuthenticationReason.REGISTER);
            }
            if(authorized(p) && inPaper(p)) remindPassword(p);
        }
    }
    private void remindPassword(Player p) {
        long now=System.currentTimeMillis();
        if(now-passwordReminders.getOrDefault(p,0L)<60_000)return;
        passwordReminders.put(p,now);
        p.sendMessage(text("[MC_AUTH_PASSWORD_SETUP] 当前尚未设置密码。请用 /register 新密码 新密码（至少六位）保护这个名字；设置后离线登录需 /login 密码，正版验证成功仍免密。"));
    }
    static boolean maySetPassword(boolean authorized,boolean firstVisit,boolean hasPassword,boolean verifiedPremium) {
        return authorized && (verifiedPremium || (firstVisit && !hasPassword));
    }
    private void setOwnPassword(Player p,String[] parts) {
        var user=libre.getDatabaseProvider().getByName(p.getUsername());
        if(user==null || !maySetPassword(authorized(p),firstPasswordSessions.contains(p),user.isRegistered(),premiumVerified(p,user.getPremiumUUID()))) {
            p.sendMessage(text("[MC_AUTH_PASSWORD_DENIED] 已有密码请用 /changepassword 旧密码 新密码；忘记旧密码可用本人正版启动器登录后 /register 新密码 新密码。"));return;
        }
        if(parts.length!=3 || !parts[1].equals(parts[2])) {
            p.sendMessage(text("[MC_AUTH_PASSWORD_SETUP] 用法：/register 新密码 新密码，两次相同，至少六位。"));return;
        }
        if(!libre.validPassword(parts[1])) {
            p.sendMessage(text("[MC_AUTH_PASSWORD_SETUP] 密码至少六位，请避免常见弱密码；重新输入 /register 新密码 新密码。"));return;
        }
        if(!passwordWrites.add(user.getUuid()))return;
        // BCrypt is intentionally slow. Keep hashing off the packet/event and
        // refresh threads, and recheck the same live session before committing.
        server.getScheduler().buildTask(this,()->{
            try {
                var hash=libre.getDefaultCryptoProvider().createHash(parts[1]);
                if(hash==null) {p.sendMessage(text("密码过长，请缩短后重新设置。[MC_AUTH_PASSWORD_SETUP]"));return;}
                synchronized(user) {
                    if(!server.getPlayer(p.getUniqueId()).filter(current->current==p).isPresent()
                        || !maySetPassword(authorized(p),firstPasswordSessions.contains(p),user.isRegistered(),premiumVerified(p,user.getPremiumUUID())))return;
                    var old=user.getHashedPassword();
                    try {user.setHashedPassword(hash);libre.getDatabaseProvider().updateUser(user);}
                    catch(Exception failure) {user.setHashedPassword(old);throw failure;}
                }
                firstPasswordSessions.remove(p);passwordReminders.remove(p);
                p.sendMessage(text("[MC_AUTH_PASSWORD_SET] 密码已设置。下次离线登录用 /login 密码；修改用 /changepassword 旧密码 新密码；正版验证成功免密。"));
            } catch(Exception failure) {p.sendMessage(text("密码暂未保存，请稍后重试 /register 新密码 新密码。[MC_AUTH_PASSWORD_SETUP]"));}
            finally {passwordWrites.remove(user.getUuid());}
        }).schedule();
    }
    private void refreshEyes() {
        if(eyes==null)return;
        for(var entry:eyeSessions.entrySet()) {
            Player p=entry.getKey();String base=eyes.body(p.getUsername(),reserved);
            if(base==null || server.getPlayer(entry.getValue()).filter(b->b.getUsername().equalsIgnoreCase(base)&&inPaper(b)&&authorized(b)).isEmpty())
                p.disconnect(text("对应本体已离线或配对已变更，请先登录本体后重连观战账号。[MC_AUTH_EYE_WAIT]"));
        }
        for(Player p:server.getAllPlayers()) {
            String base=eyes.body(p.getUsername(),reserved);
            if(base==null)continue;
            Player body=server.getPlayer(base).filter(b->inPaper(b)&&authorized(b)).orElse(null);
            if(body==null) {
                if(eyeSessions.containsKey(p))p.disconnect(text("对应本体已离线，请先登录本体再连接观战账号。[MC_AUTH_EYE_WAIT]"));
                continue;
            }
            if(authorized(p))continue;
            if(p.getCurrentServer().filter(c->c.getServerInfo().getName().equals("auth")).isEmpty())continue;
            var user=libre.getDatabaseProvider().getByName(p.getUsername());
            if(user==null || user.getSecret()!=null || libre.getAuthorizationProvider().isAwaiting2FA(p))continue;
            eyeSessions.put(p,body.getUniqueId());
            try {
                libre.getAuthorizationProvider().authorize(user,p,AuthenticationReason.LOGIN);
                p.sendMessage(text("[MC_AUTH_EYE] 观战账号已自动登录，跟随 "+body.getUsername()+"；无需输入密码。"));
            } catch(Exception e) {
                eyeSessions.remove(p);p.disconnect(text("观战登录暂未就绪，请先确认本体在线后重连。[MC_AUTH_EYE_WAIT]"));
            }
        }
    }
    private synchronized long locked(String name) {
        String raw=attempts.getProperty(key(name)); if(raw==null) return 0;
        String[] s=raw.split(","); return Long.parseLong(s[2]);
    }
    private synchronized void wrong(Player p) {
        long now=System.currentTimeMillis(); String n=key(p.getUsername());
        String[] old=attempts.getProperty(n,"0,0,0").split(",");
        long start=Long.parseLong(old[1]); int count=now-start>300_000?0:Integer.parseInt(old[0]);
        if(count==0) start=now; count++;
        long until=count>=3?now+600_000:0;
        attempts.setProperty(n,count+","+start+","+until);
        try { Files.createDirectories(attemptsFile.getParent());
            var tmp=Path.of(attemptsFile+".tmp"); try(var out=Files.newOutputStream(tmp)) { attempts.store(out,"Login failures; no credentials"); }
            Files.move(tmp,attemptsFile,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
        } catch(Exception e) { ready=false; p.disconnect(text("登录保护暂不可用，请稍后重试。")); }
        if(until>0) p.disconnect(text("密码连续错误三次，此账号暂停登录十分钟。[MC_AUTH_LOCKED]"));
    }
    @Subscribe(order=PostOrder.LAST) public void preLogin(PreLoginEvent e) {
        if(!ready) { e.setResult(PreLoginEvent.PreLoginComponentResult.denied(text("登录保护准备中，请稍后重试。[MC_AUTH_UNAVAILABLE]"))); return; }
        if(!e.getResult().isAllowed())return;
        // A stored premium UUID must not force every same-name connection into
        // online mode. LibreLogin's dual listener chooses an official challenge
        // from the login-start hint; only that challenge bypasses password locks.
        if(e.getResult().isOnlineModeAllowed() && !e.getResult().isForceOfflineMode())return;
        if(eyes!=null && eyes.body(e.getUsername(),reserved)!=null)return;
        if(locked(e.getUsername())>System.currentTimeMillis()) e.setResult(PreLoginEvent.PreLoginComponentResult.denied(text("此账号暂停登录十分钟，请稍后使用正确密码重试。[MC_AUTH_LOCKED]")));
    }
    @Subscribe(order=PostOrder.LAST) public void configurationCompatibility(PostLoginEvent e) {
        if(e.getPlayer().getProtocolVersion().getProtocol()!=766) return;
        var connection=((ConnectedPlayer)e.getPlayer()).getConnection();
        var channel=connection.getChannel();
        channel.eventLoop().execute(()->{
            var decoder=channel.pipeline().context(MinecraftDecoder.class);
            if(decoder==null) { e.getPlayer().disconnect(text("登录协议保护未就绪，请稍后重试。")); return; }
            channel.pipeline().addBefore(decoder.name(),"auth-config-compat",new ChannelInboundHandlerAdapter() {
                @Override public void channelRead(ChannelHandlerContext ctx,Object message) throws Exception {
                    // Mineflayer 4.37/4.39 continues sending movement while the
                    // proxy switches registries. Its serializer emits packet 0
                    // (settings) with movement bytes, which otherwise kills the
                    // connection. Drop only malformed settings during CONFIG.
                    if(connection.getState()==StateRegistry.CONFIG && message instanceof ByteBuf b && b.isReadable()) {
                        int at=b.readerIndex();
                        if(b.readableBytes()==1 && b.getUnsignedByte(at)==0) {ReferenceCountUtil.release(message);return;}
                    }
                    super.channelRead(ctx,message);
                }
            });
        });
    }
    @Subscribe(order=PostOrder.LAST) public void connect(ServerPreConnectEvent e) {
        if(!ready || (!authorized(e.getPlayer()) && !e.getOriginalServer().getServerInfo().getName().equals("auth")))
            e.setResult(ServerPreConnectEvent.ServerResult.denied());
    }
    @Subscribe(order=PostOrder.LAST) public void chat(PlayerChatEvent e) {
        if(!authorized(e.getPlayer())) e.setResult(PlayerChatEvent.ChatResult.denied());
    }
    @Subscribe(order=PostOrder.LAST) public void joined(ServerPostConnectEvent e) {
        notifyAuthenticated(e.getPlayer());
        // Pending is available via /authstatus, not pushed again on each limbo
        // or backend switch. The final success marker remains once per session.
    }
    @Subscribe(order=PostOrder.LAST) public void command(CommandExecuteEvent e) {
        if(!(e.getCommandSource() instanceof Player p)) return;
        String[] parts=e.getCommand().trim().split("\\s+"); String cmd=key(parts[0]);
        if(portal!=null&&portal.isManaged(p.getUniqueId())&&Set.of("register","reg","setpassword","changepassword","changepass","passwd","passch").contains(cmd.substring(cmd.lastIndexOf(':')+1))) {
            e.setResult(CommandExecuteEvent.CommandResult.denied());p.sendMessage(text("此角色使用跨世界统一密码，请到网站世界大厅改密；各服会逐项确认。"));return;
        }
        if(cmd.equals("authstatus")) {e.setResult(CommandExecuteEvent.CommandResult.denied());publishAuthentication(p);return;}
        if(Set.of("login","l","log").contains(cmd)) {
            if(logger!=null)logger.info("MC_AUTH_REQUEST account={} command={} available={}",p.getUsername(),cmd,ready);
            if(ready && authorized(p) && inPaper(p)) {
                // An explicit recovery request gets fresh authoritative state,
                // without rechecking a password, granting a session, or replaying
                // the once-per-connection MC_AUTH_SUCCESS event.
                e.setResult(CommandExecuteEvent.CommandResult.denied());
                publishAuthentication(p);
                return;
            }
        }
        boolean admin=reserved.contains(key(p.getUsername()));
        boolean eye=eyes!=null && eyes.body(p.getUsername(),reserved)!=null;
        if(!eye && ready && authorized(p) && Set.of("register","reg","setpassword").contains(cmd)) {
            e.setResult(CommandExecuteEvent.CommandResult.denied());setOwnPassword(p,parts);return;
        }
        boolean deny=!ready || (!authorized(p) && !Set.of("login","l","log","register","reg","2faconfirm").contains(cmd));
        if(eye && Set.of("premium","autologin","cracked","manuallogin","register","reg","setpassword","changepassword","changepass","passwd","passch","2fa").contains(cmd))deny=true;
        if(Set.of("cracked","manuallogin").contains(cmd) && ready) {
            var user=libre.getDatabaseProvider().getByName(p.getUsername());
            if(user!=null && !user.isRegistered())deny=true;
        }
        if(cmd.equals("librelogin")) deny=true; // Auth administration is local console only.
        // LibreLogin 0.24 skips TOTP when Protocolize is absent. Fail closed instead.
        if(Set.of("login","l","log").contains(cmd) && ready) {
            var u=libre.getDatabaseProvider().getByName(p.getUsername());
            if(u!=null && u.getSecret()!=null && libre.getTOTPProvider()==null) deny=true;
            if(admin) {
                verifiedAdminPassword.remove(p);
                if(!deny && parts.length>=2 && u!=null && u.getHashedPassword()!=null) {
                    var crypto=libre.getCryptoProvider(u.getHashedPassword().algo());
                    if(crypto!=null && crypto.matches(parts[1],u.getHashedPassword())) verifiedAdminPassword.add(p);
                }
            }
        }
        if(deny) {
            e.setResult(CommandExecuteEvent.CommandResult.denied());
            String reason;
            if(!ready) {
                reason="service_unavailable";
                p.sendMessage(text("[MC_AUTH_UNAVAILABLE] 登录服务暂不可用；当前授权尚无法确认。稍后用 /authstatus 查询，不要反复提交密码。"));
            } else if(!authorized(p)) {
                reason=ready?"login_required":"service_unavailable";
                p.sendMessage(text(ready?"[MC_AUTH_DENIED] 请先完成登录。命令：/login 密码；状态：/authstatus。":"[MC_AUTH_UNAVAILABLE] 登录服务暂不可用。稍后查询：/authstatus。"));
            } else {
                reason="command_restricted";
                p.sendMessage(text("[MC_AUTH_COMMAND_DENIED] 当前账号不能执行此项账号管理操作；登录状态未改变。查询：/authstatus。"));
            }
            if(logger!=null)logger.info("MC_AUTH_COMMAND_REJECTED account={} command={} reason={}",p.getUsername(),cmd,reason);
        }
    }
    @Subscribe public void disconnected(DisconnectEvent e) {
        authenticated.remove(e.getPlayer());verifiedAdminPassword.remove(e.getPlayer());eyeSessions.remove(e.getPlayer());premiumProofs.remove(e.getPlayer().getRemoteAddress());
        firstPasswordSessions.remove(e.getPlayer());passwordReminders.remove(e.getPlayer());
        observationSessions.remove(e.getPlayer());authenticationMethods.remove(e.getPlayer());
        authenticationNotified.remove(e.getPlayer());
        payloadPeers.remove(e.getPlayer());
    }
    @Subscribe public void stop(ProxyShutdownEvent event) {
        if(portal!=null)portal.close();
        ready=false; try { if(heartbeat!=null) Files.deleteIfExists(heartbeat); } catch(Exception ignored) { }
    }
}
