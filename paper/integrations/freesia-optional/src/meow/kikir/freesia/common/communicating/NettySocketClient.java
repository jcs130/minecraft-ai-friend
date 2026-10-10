/* SPDX-License-Identifier: MPL-2.0
 * Derived from YesSteveModel/Freesia v2.5.1+2.4.1, NettySocketClient.
 * Local changes: asynchronous bounded reconnect and explicit lifecycle cleanup.
 */
package meow.kikir.freesia.common.communicating;

import io.netty.bootstrap.Bootstrap;
import io.netty.channel.*;
import meow.kikir.freesia.common.EntryPoint;
import meow.kikir.freesia.common.NettyUtils;
import meow.kikir.freesia.common.communicating.message.IMessage;
import java.net.InetSocketAddress;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Function;

public class NettySocketClient {
    private final EventLoopGroup clientEventLoopGroup = NettyUtils.eventLoopGroup();
    private final Class<? extends Channel> clientChannelType = NettyUtils.channelClass();
    private final InetSocketAddress masterAddress;
    private final Queue<IMessage<?>> packetFlushQueue = new ConcurrentLinkedQueue<>();
    private final Function<Channel, SimpleChannelInboundHandler<?>> handlerCreator;
    private final int reconnectInterval;
    private volatile Channel channel;
    private final AtomicBoolean connecting = new AtomicBoolean();
    private volatile boolean stopped;

    public NettySocketClient(InetSocketAddress address, Function<Channel, SimpleChannelInboundHandler<?>> factory, int interval) {
        masterAddress=address;handlerCreator=factory;reconnectInterval=Math.max(1,interval);
    }
    public void connect() {
        if(stopped || channel!=null && channel.isActive() || !connecting.compareAndSet(false,true))return;
        new Bootstrap().group(clientEventLoopGroup).channel(clientChannelType)
            .option(ChannelOption.TCP_NODELAY,true).option(ChannelOption.CONNECT_TIMEOUT_MILLIS,3000)
            .handler(new ChannelInitializer<Channel>() {
                @Override protected void initChannel(Channel c) {
                    DefaultChannelPipelineLoader.loadDefaultHandlers(c);c.pipeline().addLast(handlerCreator.apply(c));
                }
            }).connect(masterAddress).addListener((ChannelFutureListener) future->{
                connecting.set(false);
                if(stopped) { future.channel().close();return; }
                if(!future.isSuccess()) retry();
            });
    }
    protected boolean shouldDoNextReconnect() { return true; }
    private void retry() {
        if(stopped || clientEventLoopGroup.isShuttingDown())return;
        clientEventLoopGroup.schedule(()->{if(!stopped && shouldDoNextReconnect())connect();},reconnectInterval,TimeUnit.SECONDS);
    }
    public void onChannelInactive() { channel=null;if(!stopped)retry(); }
    public void onChannelActive(Channel active) {
        if(stopped){active.close();return;}channel=active;flushMessageQueueIfNeeded();
    }
    private void flushMessageQueueIfNeeded() {
        Channel active=channel;if(active==null || !active.isActive())return;
        IMessage<?> message;while((message=packetFlushQueue.poll())!=null)active.writeAndFlush(message);
    }
    public void sendToMaster(IMessage<?> message) {
        if(stopped)throw new IllegalStateException("Freesia controller client stopped");
        Channel active=channel;
        if(active==null || !active.isActive()) {
            if(packetFlushQueue.size()>=256)throw new IllegalStateException("Freesia controller queue full");
            packetFlushQueue.offer(message);return;
        }
        if(!active.eventLoop().inEventLoop()){active.eventLoop().execute(()->sendToMaster(message));return;}
        flushMessageQueueIfNeeded();active.writeAndFlush(message);
    }
    public void close() {
        stopped=true;packetFlushQueue.clear();Channel active=channel;channel=null;
        if(active!=null)active.close();
        clientEventLoopGroup.shutdownGracefully(0,2,TimeUnit.SECONDS);
    }
}
