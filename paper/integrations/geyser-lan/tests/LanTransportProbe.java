import io.netty.bootstrap.Bootstrap;
import io.netty.buffer.*;
import io.netty.channel.*;
import io.netty.channel.nio.NioEventLoopGroup;
import org.cloudburstmc.netty.channel.nethernet.*;
import org.cloudburstmc.netty.channel.nethernet.config.NetherChannelOption;
import org.cloudburstmc.netty.channel.nethernet.signaling.*;
import org.cloudburstmc.netty.util.nethernet.*;
import org.cloudburstmc.protocol.common.util.VarInts;
import tel.schich.libdatachannel.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Real discovery, DTLS/SCTP and Bedrock network-settings; deliberately does not impersonate an Xbox account. */
public final class LanTransportProbe {
    public static void main(String[] args)throws Exception {
        InetAddress local=InetAddress.getByName(args[0]);var target=new InetSocketAddress(args[1],Integer.parseInt(args[2]));
        LibDataChannelArchDetect.initialize();NetherNetLogging.setNativeLogLevel("WARN");
        var discovery=new NetherNetDiscovery(new java.security.SecureRandom().nextLong());
        var versions=new ConcurrentSkipListSet<Integer>();var response=new CompletableFuture<PongData>();
        var group=new NioEventLoopGroup(2);Channel connection=null;NetherNetDiscoverySignaling signal=null;
        try {
            discovery.bind(new InetSocketAddress(local,0));
            discovery.sendDiscoveryRequest(target,(id,bytes)->{try{var p=ServerData.decode(bytes);if(p!=null){versions.add(p.dataVersion());if(p.dataVersion()==7)response.complete(p);}}finally{bytes.release();}});
            var pong=response.get(5,TimeUnit.SECONDS);
            if(!pong.onlineAuth()||pong.selfSignedAuth()||pong.nonce().isBlank())throw new AssertionError("Discovery auth/challenge incorrect");
            var settings=new CompletableFuture<Integer>();
            signal=new NetherNetDiscoverySignaling(new java.security.SecureRandom().nextLong(),new InetSocketAddress(local,0));
            connection=new Bootstrap().group(group).channelFactory(NetherNetChannelFactory.client(signal))
                .option(NetherChannelOption.NETHER_PEER_CONNECTION_CONFIG,PeerConnectionConfiguration.DEFAULT.withBindAddress(local))
                .option(NetherChannelOption.NETHER_CLIENT_HANDSHAKE_TIMEOUT_MS,8_000)
                .option(NetherChannelOption.NETHER_CLIENT_MAX_HANDSHAKE_ATTEMPTS,1)
                .handler(new SimpleChannelInboundHandler<ByteBuf>(){
                    public void channelActive(ChannelHandlerContext ctx){
                        ByteBuf packet=Unpooled.buffer();VarInts.writeUnsignedInt(packet,6);VarInts.writeUnsignedInt(packet,193);packet.writeInt(pong.protocol());ctx.writeAndFlush(packet);
                    }
                    protected void channelRead0(ChannelHandlerContext ctx,ByteBuf bytes){
                        int size=VarInts.readUnsignedInt(bytes);if(size>bytes.readableBytes())throw new AssertionError("truncated batch");
                        int id=VarInts.readUnsignedInt(bytes)&1023;settings.complete(id);
                    }
                    public void exceptionCaught(ChannelHandlerContext ctx,Throwable e){settings.completeExceptionally(e);ctx.close();}
                }).connect(target).sync().channel();
            int packet=settings.get(8,TimeUnit.SECONDS);if(packet!=143)throw new AssertionError("Expected NetworkSettings, got "+packet);
            System.out.println("{\"discoveryVersions\":"+versions+",\"protocol\":"+pong.protocol()+",\"xboxRequired\":true,\"noncePresent\":true,\"dtlsSctpConnected\":true,\"networkSettingsPacket\":"+packet+",\"gameLoginTested\":false}");
        } finally {
            if(connection!=null)connection.close().awaitUninterruptibly(3000);
            if(signal!=null)signal.close();discovery.close();group.shutdownGracefully(0,2,TimeUnit.SECONDS).awaitUninterruptibly(3000);
        }
    }
}
