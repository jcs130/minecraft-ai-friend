package org.qiandengji.geyserlan;

import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.Channel;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.util.concurrent.DefaultThreadFactory;
import org.cloudburstmc.netty.channel.nethernet.*;
import org.cloudburstmc.netty.channel.nethernet.config.NetherChannelOption;
import org.cloudburstmc.netty.channel.nethernet.signaling.*;
import org.cloudburstmc.netty.util.nethernet.*;
import org.geysermc.geyser.GeyserImpl;
import org.geysermc.geyser.network.BedrockPingHandler;
import org.geysermc.geyser.network.bedrock.nethernet.NetherNetChannelInitialiser;
import org.geysermc.geyser.session.GeyserSession;
import org.geysermc.geyser.util.JsonUtils;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.security.PublicKey;
import java.util.*;
import java.util.concurrent.TimeUnit;

/** Optional LAN transport. Public HTTP, RakNet and signed identity bindings remain upstream. */
public final class LanDiscoverySupport {
    private static final Map<GeyserImpl,LanDiscoverySupport> ACTIVE=new IdentityHashMap<>();
    private final GeyserImpl geyser;
    private final LanAdmissionLedger ledger;
    private final int discoveryPort,icePort;
    private Channel channel;
    private EventLoopGroup group;
    private NetherNetChannelInitialiser initialiser;
    private NetherNetDiscoverySignaling signaling;

    private LanDiscoverySupport(GeyserImpl geyser,Properties config) {
        this.geyser=geyser;this.ledger=new LanAdmissionLedger(config.getProperty("cidr",""));
        this.discoveryPort=Integer.parseInt(config.getProperty("discovery-port","7551"));
        this.icePort=Integer.parseInt(config.getProperty("ice-port","19134"));
        var b=geyser.config().bedrock();
        if(discoveryPort<1024||discoveryPort>65535||icePort<1024||icePort>65535||icePort==discoveryPort||icePort==b.webrtcPort()||icePort==b.raknetPort())throw new IllegalArgumentException("Distinct LAN discovery and ICE ports required");
    }
    public static synchronized void start(GeyserImpl geyser) {
        if(ACTIVE.containsKey(geyser))return;
        Path file=geyser.getBootstrap().getConfigFolder().resolve("lan-discovery.properties");
        if(!Files.isRegularFile(file))return;
        LanDiscoverySupport service=null;
        try {
            Properties config=new Properties();try(InputStream in=Files.newInputStream(file)){config.load(in);}
            if(!"true".equals(config.getProperty("enabled")))return;
            if(!geyser.config().advanced().bedrock().validateBedrockLogin()||geyser.config().advanced().bedrock().useWaterdogpeForwarding())throw new IllegalStateException("LAN requires direct Xbox-verified login");
            service=new LanDiscoverySupport(geyser,config);service.open();ACTIVE.put(geyser,service);
            geyser.getLogger().info("Qiandengji LAN discovery ready on UDP "+service.discoveryPort+", LAN ICE UDP "+service.icePort+"; Xbox signatures and expiring LAN challenges required");
        } catch(Exception|LinkageError failure) {
            if(service!=null)service.close();
            geyser.getLogger().error("Qiandengji LAN discovery failed; existing transports retained",failure);
        }
    }
    private void open() throws Exception {
        long guid=new java.security.SecureRandom().nextLong();
        var identity=OperatorIdentity.fromPemOrCreate(geyser.getBootstrap().getConfigFolder().resolve("nethernet/identity.pem").toFile(),GeyserImpl.NAME+"-"+geyser.config().gameplay().serverName());
        signaling=new LanAnswerSignaling(guid,new InetSocketAddress("0.0.0.0",discoveryPort),ledger);
        signaling.setServerIdentity(identity);signaling.setTokenTrust(TokenTrust.MINECRAFT_AUTH);
        var ping=new BedrockPingHandler(geyser);
        signaling.setMotdProvider((host,remote,client)->{
            String nonce=ledger.challenge(remote.getAddress());if(nonce==null)return null;
            var p=ping.onQuery(guid,remote,null);
            return new PongData.Builder().setServerName(p.motd()).setLevelName(p.subMotd()).setProtocol(p.protocolVersion()).setVersion(p.version()).setPlayerCount(p.playerCount()).setMaxPlayerCount(p.maximumPlayerCount()).setOnlineAuth(true).setSelfSignedAuth(false).setNonce(nonce).build();
        });
        group=new NioEventLoopGroup(2,new DefaultThreadFactory("Qiandengji NetherNet LAN",true));
        initialiser=new NetherNetChannelInitialiser(geyser);
        // A dedicated fixed ICE port keeps the LAN firewall narrow and does not contend with HTTP.
        channel=new ServerBootstrap().group(group).channelFactory(NetherNetChannelFactory.server(signaling))
            .option(NetherChannelOption.NETHER_SERVER_ICE_ADDRESS,new InetSocketAddress("0.0.0.0",icePort))
            .childHandler(initialiser).bind("0.0.0.0",discoveryPort).sync().channel();
    }
    public static synchronized void stop(GeyserImpl geyser) {
        var service=ACTIVE.remove(geyser);if(service!=null)service.close();
    }
    private void close() {
        if(channel!=null)channel.close().awaitUninterruptibly(5000);
        if(signaling!=null)signaling.close();
        if(group!=null)group.shutdownGracefully(0,3,TimeUnit.SECONDS).awaitUninterruptibly(4000);
        if(initialiser!=null)initialiser.getEventLoopGroup().shutdownGracefully(0,3,TimeUnit.SECONDS).awaitUninterruptibly(4000);
    }
    /** Invoked from the pinned upstream login method after both cryptographic validations. */
    public static String mismatch(Channel channel,PublicKey key,GeyserSession session,boolean signed,byte[] verifiedPayload) {
        if(TransportIdentityBinding.state(channel)!=TransportIdentityBinding.State.NONE)return TransportIdentityBinding.mismatch(channel,key);
        if(!(channel instanceof NetherNetChannel nether)||nether.signaledAddress().source()!=AddressSource.SIGNALING_LAN)return TransportIdentityBinding.mismatch(channel,key);
        LanDiscoverySupport service;
        synchronized(LanDiscoverySupport.class){service=ACTIVE.get(session.getGeyser());}
        if(service==null||!session.getGeyser().config().advanced().bedrock().validateBedrockLogin())return "LAN_LOGIN_UNAVAILABLE";
        try {
            var data=JsonUtils.fromJson(verifiedPayload,com.google.gson.JsonObject.class);
            var nonce=data.get("Nonce");
            if(nonce==null||!nonce.isJsonPrimitive()||!nonce.getAsJsonPrimitive().isString())return "LAN_CHALLENGE_MISSING";
            String refusal=service.ledger.consume(nether.signaledAddress().address().getAddress(),signed,nonce.getAsString(),verifiedPayload);
            if(refusal!=null)return refusal;
            // Record the verified login key as spent on this connection, preserving binding state semantics.
            byte[] expected=IdentityPublicKey.canonical(key);
            TransportIdentityBinding.install(channel,new IdentityKeyVerifier(){
                protected boolean matches(byte[] supplied){return java.security.MessageDigest.isEqual(expected,supplied);}
                protected void release(){Arrays.fill(expected,(byte)0);}
            });
            return TransportIdentityBinding.mismatch(channel,key);
        } catch(Exception failure) { return "LAN_LOGIN_INVALID_CHALLENGE"; }
    }
}
