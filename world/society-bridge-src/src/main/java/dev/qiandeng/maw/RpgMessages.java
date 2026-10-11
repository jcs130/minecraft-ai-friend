package dev.qiandeng.maw;

import com.google.gson.*;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import java.nio.charset.StandardCharsets;

/** Raw UTF-8 private compatibility channels; never a system-chat fallback. */
final class RpgMessages {
    private record State(String json) implements CustomPacketPayload {static final Type<State> TYPE=new Type<>(ResourceLocation.parse("mcagent:state"));public Type<State> type(){return TYPE;}}
    private record Viewer(String json) implements CustomPacketPayload {static final Type<Viewer> TYPE=new Type<>(ResourceLocation.parse("mcviewer:state"));public Type<Viewer> type(){return TYPE;}}
    private record Protection(String json) implements CustomPacketPayload {static final Type<Protection> TYPE=new Type<>(ResourceLocation.parse("mcagent:protection"));public Type<Protection> type(){return TYPE;}}
    private record Event(String json) implements CustomPacketPayload {static final Type<Event> TYPE=new Type<>(ResourceLocation.parse("mcagent:event"));public Type<Event> type(){return TYPE;}}
    interface Maker<T>{T create(String json);}
    private static <T> StreamCodec<RegistryFriendlyByteBuf,T> codec(Maker<T> make,java.util.function.Function<T,String> extract){return StreamCodec.of((b,p)->{byte[] a=extract.apply(p).getBytes(StandardCharsets.UTF_8);if(a.length>16384)throw new IllegalArgumentException("rpg_payload_over_budget");b.writeBytes(a);},b->{if(b.readableBytes()>16384)throw new IllegalArgumentException("rpg_payload_over_budget");byte[] a=new byte[b.readableBytes()];b.readBytes(a);return make.create(new String(a,StandardCharsets.UTF_8));});}
    static void register(IEventBus bus){bus.addListener((RegisterPayloadHandlersEvent e)->{var r=e.registrar("1").optional();r.playToClient(State.TYPE,codec(State::new,State::json),(p,c)->{});r.playToClient(Viewer.TYPE,codec(Viewer::new,Viewer::json),(p,c)->{});r.playToClient(Protection.TYPE,codec(Protection::new,Protection::json),(p,c)->{});r.playToClient(Event.TYPE,codec(Event::new,Event::json),(p,c)->{});});}
    static void state(ServerPlayer p,JsonObject value,boolean changed,boolean viewerRefresh){String s=value.toString();if(changed&&p.connection.hasChannel(State.TYPE))PacketDistributor.sendToPlayer(p,new State(s));if((changed||viewerRefresh)&&p.connection.hasChannel(Viewer.TYPE))PacketDistributor.sendToPlayer(p,new Viewer(s));}
    static void protection(ServerPlayer p,JsonObject value){if(p.connection.hasChannel(Protection.TYPE))PacketDistributor.sendToPlayer(p,new Protection(value.toString()));}
    static void event(ServerPlayer p,JsonObject value){if(p.connection.hasChannel(Event.TYPE))PacketDistributor.sendToPlayer(p,new Event(value.toString()));}
}
