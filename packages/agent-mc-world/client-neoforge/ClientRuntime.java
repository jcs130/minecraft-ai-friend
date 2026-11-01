package org.agentmc.platform;

import java.nio.file.Path;import java.util.*;import java.util.concurrent.*;import java.util.function.*;
import net.minecraft.client.*;import net.minecraft.client.gui.GuiGraphics;import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.chat.Component;import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.network.codec.StreamCodec;import net.minecraft.network.RegistryFriendlyByteBuf;
import net.neoforged.fml.ModList;import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;

/** Native NeoForge event boundary for the existing shared client policies.
 * No game loop, model loop, server discovery or server mutation is hidden here.
 */
public final class ClientRuntime {
 private ClientRuntime(){}
 public interface ClientEntrypoint {void onInitializeClient();}
 public static final class Signal<T>{private final List<T> listeners=new CopyOnWriteArrayList<>();public void register(T listener){listeners.add(Objects.requireNonNull(listener));}public List<T> snapshot(){return List.copyOf(listeners);}}
 @FunctionalInterface public interface Join {void accept(ClientPacketListener handler,Object sender,Minecraft client);}
 @FunctionalInterface public interface Leave {void accept(ClientPacketListener handler,Minecraft client);}
 @FunctionalInterface public interface Message {void accept(Component text,boolean overlay);}
 @FunctionalInterface public interface AllowMessage {boolean accept(Component text,boolean overlay);}
 @FunctionalInterface public interface Hud {void accept(GuiGraphics graphics,DeltaTracker delta);}
 public static final class ClientPlayConnectionEvents {public static final Signal<Join> JOIN=new Signal<>();public static final Signal<Leave> DISCONNECT=new Signal<>();}
 public static final class ClientTickEvents {public static final Signal<Consumer<Minecraft>> END_CLIENT_TICK=new Signal<>();}
 public static final class ClientLifecycleEvents {public static final Signal<Consumer<Minecraft>> CLIENT_STARTED=new Signal<>(),CLIENT_STOPPING=new Signal<>();}
 public static final class ClientReceiveMessageEvents {public static final Signal<Message> GAME=new Signal<>();public static final Signal<AllowMessage> ALLOW_GAME=new Signal<>();}
 public static final class HudRenderCallback {public static final Signal<Hud> EVENT=new Signal<>();}
 public static final class WorldRenderEvents {public static final Signal<Consumer<Object>> END=new Signal<>();}
 public static final class KeyBindingHelper {
  private static final List<KeyMapping> mappings=new CopyOnWriteArrayList<>();
  public static KeyMapping registerKeyBinding(KeyMapping value){mappings.add(value);return value;}
  public static List<KeyMapping> keys(){return List.copyOf(mappings);}
 }
 public static final class ClientLoader {
  private static final ClientLoader INSTANCE=new ClientLoader();
  public static ClientLoader getInstance(){return INSTANCE;}
  public Path getConfigDir(){return FMLPaths.CONFIGDIR.get();} public Path getGameDir(){return FMLPaths.GAMEDIR.get();}
  private String nativeId(String id){return switch(id){case "mcvisual-native-director"->"mcvisual_native_director";case "mcvisual-native-observer"->"mcvisual_native_observer";case "mcvisual-native-orthographic"->"mcvisual_native_director";default->id.replace('-','_');};}
  public boolean isModLoaded(String id){return ModList.get().isLoaded(nativeId(id));}
  public Optional<Container> getModContainer(String id){return ModList.get().getModContainerById(nativeId(id)).map(c->new Container(c.getModInfo().getVersion().toString()));}
 }
 public record Container(String value){public Container getMetadata(){return this;}public Container getVersion(){return this;}public String getFriendlyString(){return value;}}
 public record Context(Minecraft client){}
 @FunctionalInterface public interface PayloadHandler<T extends CustomPacketPayload>{void receive(T payload,Context context);}
 private record Registered<T extends CustomPacketPayload>(CustomPacketPayload.Type<T> type,StreamCodec<? super RegistryFriendlyByteBuf,T> codec){
  void declare(RegisterPayloadHandlersEvent event){event.registrar("agentmc-client-v1").optional().playToClient(type,codec,(data,context)->{
   var slot=RECEIVERS.get(type.id().toString());var client=Minecraft.getInstance();
   if(slot==null||client.getConnection()!=slot.connection)return;
   context.enqueueWork(()->{if(client.getConnection()==slot.connection&&RECEIVERS.get(type.id().toString())==slot)slot.receive(data);});
  });}
 }
 private record Receiver(ClientPacketListener connection,PayloadHandler<CustomPacketPayload> handler){void receive(CustomPacketPayload payload){handler.receive(payload,new Context(Minecraft.getInstance()));}}
 private static final Map<String,Registered<?>> TYPES=new ConcurrentHashMap<>();
 private static final Map<String,Receiver> RECEIVERS=new ConcurrentHashMap<>();
 public static final class PayloadTypeRegistry {
  private static final PayloadTypeRegistry INSTANCE=new PayloadTypeRegistry();public static PayloadTypeRegistry playS2C(){return INSTANCE;}
  public <T extends CustomPacketPayload> void register(CustomPacketPayload.Type<T> type,StreamCodec<? super RegistryFriendlyByteBuf,T> codec){
   if(TYPES.putIfAbsent(type.id().toString(),new Registered<>(type,codec))!=null)throw new IllegalArgumentException("Payload codec already registered");
  }
 }
 public static final class ClientPlayNetworking {
  @SuppressWarnings("unchecked") public static <T extends CustomPacketPayload> boolean registerReceiver(CustomPacketPayload.Type<T> type,PayloadHandler<T> receiver){
   var connection=Minecraft.getInstance().getConnection();if(connection==null||!TYPES.containsKey(type.id().toString()))return false;
   return RECEIVERS.putIfAbsent(type.id().toString(),new Receiver(connection,(PayloadHandler<CustomPacketPayload>)(Object)receiver))==null;
  }
 }
 static void registerPayloads(RegisterPayloadHandlersEvent event){for(var type:TYPES.values())type.declare(event);}
 static void clearConnectionReceivers(){RECEIVERS.clear();}
}
