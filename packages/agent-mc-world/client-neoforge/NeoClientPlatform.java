package org.agentmc.platform;

import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.client.event.*;
import net.neoforged.neoforge.event.GameShuttingDownEvent;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;

/** Lifecycle adapter only. Shared login/appearance policies remain owned by the core. */
@Mod(value="agentmc_client_platform",dist=Dist.CLIENT)
public final class NeoClientPlatform {
 private ClientPacketListener connection;private boolean started;
 public NeoClientPlatform(IEventBus modBus){
  new org.cortico.minecraft.CorticoClientLogin().onInitializeClient();
  new org.agentmc.appearance.ClientAppearances().onInitializeClient();
  modBus.addListener((RegisterKeyMappingsEvent e)->ClientRuntime.KeyBindingHelper.keys().forEach(e::register));
  modBus.addListener((RegisterPayloadHandlersEvent e)->ClientRuntime.registerPayloads(e));
  NeoForge.EVENT_BUS.addListener((ClientPlayerNetworkEvent.LoggingIn e)->{
   var client=Minecraft.getInstance();var handler=client.getConnection();if(handler==null||connection==handler)return;
   if(connection!=null)leave(client);connection=handler;
   for(var listener:ClientRuntime.ClientPlayConnectionEvents.JOIN.snapshot())listener.accept(handler,null,client);
  });
  NeoForge.EVENT_BUS.addListener((ClientPlayerNetworkEvent.LoggingOut e)->leave(Minecraft.getInstance()));
  NeoForge.EVENT_BUS.addListener((ClientTickEvent.Post e)->{
   var client=Minecraft.getInstance();
   if(!started){started=true;for(var listener:ClientRuntime.ClientLifecycleEvents.CLIENT_STARTED.snapshot())listener.accept(client);}
   for(var listener:ClientRuntime.ClientTickEvents.END_CLIENT_TICK.snapshot())listener.accept(client);
  });
  NeoForge.EVENT_BUS.addListener((ClientChatReceivedEvent.System e)->{
   boolean allow=true;for(var listener:ClientRuntime.ClientReceiveMessageEvents.ALLOW_GAME.snapshot())allow&=listener.accept(e.getMessage(),e.isOverlay());
   if(!allow){e.setCanceled(true);return;}
   for(var listener:ClientRuntime.ClientReceiveMessageEvents.GAME.snapshot())listener.accept(e.getMessage(),e.isOverlay());
  });
  NeoForge.EVENT_BUS.addListener((RenderGuiEvent.Post e)->{for(var listener:ClientRuntime.HudRenderCallback.EVENT.snapshot())listener.accept(e.getGuiGraphics(),e.getPartialTick());});
  NeoForge.EVENT_BUS.addListener((RenderLevelStageEvent e)->{if(e.getStage()==RenderLevelStageEvent.Stage.AFTER_LEVEL)for(var listener:ClientRuntime.WorldRenderEvents.END.snapshot())listener.accept(e);});
  NeoForge.EVENT_BUS.addListener((GameShuttingDownEvent e)->{for(var listener:ClientRuntime.ClientLifecycleEvents.CLIENT_STOPPING.snapshot())listener.accept(Minecraft.getInstance());});
 }
 private void leave(Minecraft client){
  var prior=connection;connection=null;ClientRuntime.clearConnectionReceivers();if(prior==null)return;
  for(var listener:ClientRuntime.ClientPlayConnectionEvents.DISCONNECT.snapshot())listener.accept(prior,client);
 }
}
