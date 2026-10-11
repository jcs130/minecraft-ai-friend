package dev.qiandeng.maw;

import com.google.gson.*;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.saveddata.SavedData;
import java.nio.charset.StandardCharsets;

/** World-owned progression, claims and reward storage. Never reads or writes the old server. */
final class RpgStore extends SavedData {
    final JsonObject root;
    RpgStore() { root=new JsonObject();root.addProperty("schemaVersion",1);root.add("players",new JsonObject());root.add("claims",new JsonObject()); }
    RpgStore(JsonObject root) {this.root=root;}
    static RpgStore load(CompoundTag tag,HolderLookup.Provider lookup) {
        String json=tag.contains("jsonUtf8",7)?new String(tag.getByteArray("jsonUtf8"),StandardCharsets.UTF_8):tag.getString("json");
        JsonObject root=JsonParser.parseString(json).getAsJsonObject();
        if(root.get("schemaVersion").getAsInt()!=1)throw new IllegalStateException("unsupported_rpg_store_version");
        return new RpgStore(root);
    }
    // NBT strings have a 64 KiB modified-UTF limit. Full item components can exceed it well before a personal box fills.
    @Override public CompoundTag save(CompoundTag tag,HolderLookup.Provider lookup) {tag.putByteArray("jsonUtf8",root.toString().getBytes(StandardCharsets.UTF_8));return tag;}
    static RpgStore of(MinecraftServer server) {return server.overworld().getDataStorage().computeIfAbsent(new SavedData.Factory<>(RpgStore::new,RpgStore::load,null),"maw_rpg");}
    static JsonObject player(ServerPlayer player) {
        RpgStore store=of(player.getServer());JsonObject players=store.root.getAsJsonObject("players");String id=player.getUUID().toString();
        if(!players.has(id)){JsonObject p=new JsonObject();p.addProperty("profession","");p.addProperty("spentPoints",0);p.add("skills",new JsonObject());p.add("evidence",new JsonObject());p.add("stash",new JsonObject());p.add("pending",new JsonArray());p.add("waypoints",new JsonObject());players.add(id,p);store.setDirty();}
        return players.getAsJsonObject(id);
    }
    static JsonObject object(JsonObject root,String key) {if(!root.has(key))root.add(key,new JsonObject());return root.getAsJsonObject(key);}
    static int integer(JsonObject root,String key) {return root.has(key)?root.get(key).getAsInt():0;}
    static long number(JsonObject root,String key) {return root.has(key)?root.get(key).getAsLong():0;}
    static void evidence(ServerPlayer player,String key,int amount) {JsonObject e=object(player(player),"evidence");e.addProperty(key,Math.min(1000000000L,number(e,key)+amount));dirty(player);}
    static void dirty(ServerPlayer player){of(player.getServer()).setDirty();}
}
