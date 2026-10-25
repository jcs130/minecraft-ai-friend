/* SPDX-License-Identifier: MPL-2.0 */
package meow.kikir.freesia.velocity.network.ysm;

import com.github.retrooper.packetevents.protocol.nbt.*;
import com.github.retrooper.packetevents.protocol.nbt.serializer.DefaultNBTSerializer;
import com.velocitypowered.api.event.EventManager;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import meow.kikir.freesia.velocity.Freesia;
import meow.kikir.freesia.velocity.FreesiaConfig;
import meow.kikir.freesia.velocity.network.backend.MasterServerMessageHandler;
import net.kyori.adventure.text.Component;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

/** The actual manager/readback path with in-memory transport boundaries only.
 * Opens no sockets and creates no Minecraft accounts. PLAY lifecycle has its
 * own YsmPlayGateTest; these tests cover native/non-native recovery and races. */
public final class WorkerStateRecoveryTest {
    static int checks;
    static void check(boolean pass,String name){if(!pass)throw new AssertionError(name);checks++;}
    static final class Worker extends MasterServerMessageHandler {
        final List<String> commands=new ArrayList<>();
        @Override public void dispatchCommandToWorker(String command,Consumer<Component> callback){commands.add(command);}
    }
    static final class State extends YsmPacketProxyLayer {
        int notifications;
        State(Player p){super(p);setPlayerEntityId(42);setPlayerWorkerEntityId(7);notifications=0;}
        @Override public ProxyComputeResult processC2S(net.kyori.adventure.key.Key key,io.netty.buffer.ByteBuf data){throw new AssertionError("no fabricated client packets");}
        @Override public ProxyComputeResult processS2C(net.kyori.adventure.key.Key key,io.netty.buffer.ByteBuf data){throw new AssertionError("no fabricated server packets");}
        @Override public CompletableFuture<Set<UUID>> fetchTrackerList(UUID p){return CompletableFuture.completedFuture(Set.of());}
        @Override public void notifyFullTrackerUpdates(){notifications++;}
    }
    static final class Manager extends YsmMapperPayloadManager {
        boolean ready=true;
        Manager(){super(p->null,id->null);}
        @Override public boolean acceptsWorkerPayload(MapperSessionProcessor mapper){return ready;}
    }
    @SuppressWarnings("unchecked")
    static <T>T mock(Class<T> type,InvocationHandler fn){return (T)Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{type},fn);}
    @SuppressWarnings("unchecked")
    static Map<Player,MapperSessionProcessor> mappers(Manager m)throws Exception{
        Field f=YsmMapperPayloadManager.class.getDeclaredField("mapperSessions");f.setAccessible(true);return (Map<Player,MapperSessionProcessor>)f.get(m);
    }
    @SuppressWarnings("unchecked")
    static Map<UUID,MapperSessionProcessor> initialized(Manager m)throws Exception{
        Field f=YsmMapperPayloadManager.class.getDeclaredField("observersResynced");f.setAccessible(true);return (Map<UUID,MapperSessionProcessor>)f.get(m);
    }
    static NBTCompound selection(String model){
        NBTCompound tag=new NBTCompound();tag.setTag("model_id",new NBTString(model));tag.setTag("select_texture",new NBTString("original"));tag.setTag("mandatory",new NBTByte((byte)0));return tag;
    }
    static byte[] encode(NBTCompound selection)throws Exception{
        NBTCompound full=new NBTCompound();full.setTag("model_id",selection);ByteArrayOutputStream bytes=new ByteArrayOutputStream();
        new DefaultNBTSerializer().serializeTag(new DataOutputStream(bytes),full,false);return bytes.toByteArray();
    }
    static final class Fixture {
        final UUID uuid=UUID.randomUUID();final Player owner;final Worker worker=new Worker();final Manager manager=new Manager();final State state;
        boolean defer;final List<Runnable> events=new ArrayList<>();
        Fixture(boolean nativeClient)throws Exception{this(nativeClient,true);}
        Fixture(boolean nativeClient,boolean cacheReady)throws Exception{
            owner=mock(Player.class,(p,m,a)->switch(m.getName()){
                case "getUniqueId"->uuid;case "getUsername"->"FixtureOwner";case "hashCode"->uuid.hashCode();case "equals"->p==a[0];case "toString"->"FixtureOwner";default->null;});
            EventManager eventManager=mock(EventManager.class,(p,m,a)->{
                if(!m.getName().equals("fire"))throw new AssertionError(m.getName());
                CompletableFuture<Object> result=new CompletableFuture<>();Runnable complete=()->result.complete(a[0]);
                if(defer)events.add(complete);else complete.run();return result;
            });
            Freesia.PROXY_SERVER=mock(ProxyServer.class,(p,m,a)->switch(m.getName()){
                case "getAllPlayers"->List.of(owner);case "getPlayer"->Objects.equals(a[0],uuid)?Optional.of(owner):Optional.empty();case "getEventManager"->eventManager;default->null;});
            Freesia.registedWorkers.clear();Freesia.registedWorkers.put(UUID.randomUUID(),worker);
            Freesia.LOGGER=org.slf4j.LoggerFactory.getLogger("recovery-test");Freesia.mapperManager=manager;
            FreesiaConfig.kickIfYsmNotInstalled=false;state=new State(owner);
            mappers(manager).put(owner,new MapperSessionProcessor(owner,state,manager));
            if(nativeClient){
                manager.onClientYsmHandshakePacketReply(owner);
                // Model the separate native cache-init receipt, never infer it
                // from the version handshake or wait for an arbitrary timer.
                if(cacheReady)initialized(manager).put(uuid,mappers(manager).get(owner));
            }
        }
        WorkerStateRestoreGate.Ticket query(){manager.retryOptionalMappers();return manager.captureWorkerStateReadback(uuid,worker);}
    }
    public static void main(String[] args)throws Exception{
        for(boolean installed:new boolean[]{false,true}){
            Fixture f=new Fixture(installed);var ticket=f.query();
            check(ticket!=null,"missing cache queried regardless of installed YSM="+installed);
            check(f.worker.commands.equals(List.of("data get entity "+f.uuid+" ysm.model_id")),"only native read-only query issued");
            f.manager.acceptWorkerStateReadback(ticket,f.worker,encode(selection("saved_model")));
            check(f.state.getCurrentEntityState().getStringTagValueOrDefault("model_id","").equals("saved_model"),"original model restored");
            check(f.state.getCurrentEntityState().getStringTagValueOrDefault("select_texture","").equals("original"),"texture preserved");
            check(f.state.getCurrentEntityState().getTagOrNull("mandatory").equals(new NBTByte((byte)0)),"nonmandatory flag preserved");
            check(f.state.notifications==1,"one native tracker notification");
            f.manager.retryOptionalMappers();check(f.worker.commands.size()==1,"confirmed state never repeatedly queried");
        }
        Fixture notReady=new Fixture(true);notReady.manager.ready=false;check(notReady.query()==null,"not PLAY-ready is not queried");
        Fixture handshakeOnly=new Fixture(true,false);
        check(handshakeOnly.query()==null&&handshakeOnly.worker.commands.isEmpty(),"version reply alone cannot trigger native state replay");
        initialized(handshakeOnly.manager).put(handshakeOnly.uuid,mappers(handshakeOnly.manager).get(handshakeOnly.owner));
        check(handshakeOnly.query()!=null,"native cache initialization unlocks read-only recovery");
        Fixture cacheReset=new Fixture(true);var resetTicket=cacheReset.query();
        initialized(cacheReset.manager).clear();cacheReset.manager.acceptWorkerStateReadback(resetTicket,cacheReset.worker,encode(selection("stale_cache")));
        check(cacheReset.state.getCurrentEntityState()==null&&cacheReset.state.notifications==0,"cache reset also invalidates pending completion");
        Fixture race=new Fixture(true);var ticket=race.query();race.defer=true;
        race.manager.acceptWorkerStateReadback(ticket,race.worker,encode(selection("old_model")));
        race.state.setEntityDataRaw(selection("new_native_model"));race.events.removeFirst().run();
        check(race.state.getCurrentEntityState().getStringTagValueOrDefault("model_id","").equals("new_native_model"),"native packet wins asynchronous race");
        check(race.state.notifications==0,"race does not issue duplicate native updates");
        Fixture transfer=new Fixture(true);var old=transfer.query();transfer.defer=true;
        transfer.manager.acceptWorkerStateReadback(old,transfer.worker,encode(selection("old_model")));
        State replacement=new State(transfer.owner);mappers(transfer.manager).put(transfer.owner,new MapperSessionProcessor(transfer.owner,replacement,transfer.manager));
        transfer.events.removeFirst().run();check(transfer.state.getCurrentEntityState()==null&&replacement.getCurrentEntityState()==null,"late completion never populates a replacement mapper");
        Fixture invalid=new Fixture(true);var pending=invalid.query();invalid.manager.acceptWorkerStateReadback(pending,new Worker(),encode(selection("wrong_worker")));
        invalid.manager.acceptWorkerStateReadback(pending,invalid.worker,new byte[128*1024+1]);
        invalid.manager.acceptWorkerStateReadback(pending,invalid.worker,new byte[]{1,2,3});
        check(invalid.state.getCurrentEntityState()==null&&invalid.state.notifications==0,"foreign and invalid readbacks fail closed");
        Freesia.registedWorkers.clear();
        System.out.println("Worker manager recovery checks: "+checks+"; sockets=0; game accounts=0");
    }
}
