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
import com.github.retrooper.packetevents.PacketEvents;
import com.github.retrooper.packetevents.event.*;
import com.github.retrooper.packetevents.protocol.packettype.PacketType;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
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
        catch (Exception e) { ready=false; return false; }
    }
    @Subscribe(order=PostOrder.LAST) public void start(ProxyInitializeEvent event) throws Exception {
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
            if(ready) { refreshEyes(); refreshFirstPasswords(); }
        } catch(Throwable e) { ready=false; }
        if(heartbeat!=null) try {
            var names=server.getAllPlayers().stream().filter(this::authorized).map(Player::getUsername).toList();
            var tmp=Path.of(heartbeat+".tmp"); Files.createDirectories(heartbeat.getParent());
            var observations=server.getAllPlayers().stream().map(this::authenticationState).toList();
            Files.writeString(tmp,gson.toJson(Map.of("ready",ready,"at",System.currentTimeMillis(),"authorizedNames",names,"sessionStates",observations)));
            Files.move(tmp,heartbeat,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
        } catch(Exception e) { ready=false; }
    }
    JsonObject authenticationState(Player p) {
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("source","login_guard");
        out.addProperty("playerUuid",p.getUniqueId().toString());
        out.addProperty("authSessionId",observationSessions.computeIfAbsent(p,ignored->UUID.randomUUID().toString()));
        out.addProperty("observedAt",System.currentTimeMillis());out.addProperty("readOnly",true);
        boolean granted=authorized(p);out.addProperty("status",!ready?"unavailable":granted?"authenticated":"pending");
        out.add("authorized",ready?new com.google.gson.JsonPrimitive(granted):com.google.gson.JsonNull.INSTANCE);out.addProperty("method",authenticationMethods.getOrDefault(p,"unknown"));
        try{var user=libre.getDatabaseProvider().getByName(p.getUsername());
            out.add("passwordSet",user==null?com.google.gson.JsonNull.INSTANCE:new com.google.gson.JsonPrimitive(user.isRegistered()));}
        catch(Exception unavailable){out.add("passwordSet",com.google.gson.JsonNull.INSTANCE);}
        out.addProperty("nextCommand",granted?"/mycli status":"/authstatus");return out;
    }
    private void publishAuthentication(Player p) {
        if(!p.isActive())return;
        JsonObject out=authenticationState(p);
        p.sendMessage(text("MC_AUTH_STATE "+out));
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
            p.sendMessage(text("[MC_AUTH_DENIED] 已有密码请用 /changepassword 旧密码 新密码；忘记旧密码可用本人正版启动器登录后 /register 新密码 新密码。"));return;
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
        if(e.getPlayer().getCurrentServer().filter(s->!s.getServerInfo().getName().equals("auth")).isPresent() && authorized(e.getPlayer()))
            e.getPlayer().sendMessage(text("[MC_AUTH_SUCCESS] 登录成功，可以开始游戏。"));
        publishAuthentication(e.getPlayer());
    }
    @Subscribe(order=PostOrder.LAST) public void command(CommandExecuteEvent e) {
        if(!(e.getCommandSource() instanceof Player p)) return;
        String[] parts=e.getCommand().trim().split("\\s+"); String cmd=key(parts[0]);
        if(cmd.equals("authstatus")) {e.setResult(CommandExecuteEvent.CommandResult.denied());publishAuthentication(p);return;}
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
            p.sendMessage(text("[MC_AUTH_DENIED] 正版验证成功免密；已有密码的离线账号先 /login 密码。首次进入后用 /register 新密码 新密码 设置；Eye请先登录对应本体。"));
        }
    }
    @Subscribe public void disconnected(DisconnectEvent e) {
        authenticated.remove(e.getPlayer());verifiedAdminPassword.remove(e.getPlayer());eyeSessions.remove(e.getPlayer());premiumProofs.remove(e.getPlayer().getRemoteAddress());
        firstPasswordSessions.remove(e.getPlayer());passwordReminders.remove(e.getPlayer());
        observationSessions.remove(e.getPlayer());authenticationMethods.remove(e.getPlayer());
    }
    @Subscribe public void stop(ProxyShutdownEvent event) {
        ready=false; try { if(heartbeat!=null) Files.deleteIfExists(heartbeat); } catch(Exception ignored) { }
    }
}
