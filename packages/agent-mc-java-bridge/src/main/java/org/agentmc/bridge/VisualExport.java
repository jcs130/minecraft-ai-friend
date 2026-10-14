package org.agentmc.bridge;

import com.google.gson.*;
import io.netty.buffer.Unpooled;
import java.util.*;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientChunkEvents;
import net.minecraft.*;

/** Read-only render observations from this client's world. No screenshots, controller or extra login. */
public final class VisualExport {
    private static VisualExport active;
    private final class_310 client;
    private final Gson gson = new Gson();
    private final Map<Long, Long> revisions = new HashMap<>();
    private class_638 world;
    private String epoch = "";
    private long revision, sequence;
    private JsonObject registry;
    public VisualExport(class_310 client) {
        this.client = client; active = this;
        ClientChunkEvents.CHUNK_LOAD.register((w, chunk) -> changed(w, chunk.method_12004().field_9181, chunk.method_12004().field_9180));
        ClientChunkEvents.CHUNK_UNLOAD.register((w, chunk) -> { if (w == world) revisions.remove(key(chunk.method_12004().field_9181, chunk.method_12004().field_9180)); });
    }
    private static long key(int x, int z) { return ((long)x << 32) ^ (z & 0xffffffffL); }
    public static void changed(class_638 w, int x, int z) {
        if (active != null && w == active.client.field_1687) {
            active.refresh();
            // Normally bounded by the client's own loaded chunk cache.
            if (active.revisions.size() >= 16384) { active.revisions.clear(); active.epoch = UUID.randomUUID().toString(); }
            active.revisions.put(key(x, z), ++active.revision);
        }
    }
    public static void lightChanged(int x, int z) { if (active != null) changed(active.client.field_1687, x, z); }
    private void refresh() {
        if (world != client.field_1687) { world = client.field_1687; epoch = UUID.randomUUID().toString(); revisions.clear(); registry = null; }
    }
    private JsonObject base() {
        refresh(); JsonObject out = new JsonObject();
        out.addProperty("protocol", "agent-mc-visual/v1"); out.addProperty("minecraftVersion", "1.20.6");
        out.addProperty("epoch", epoch); out.addProperty("sequence", ++sequence); out.addProperty("sampledAt", System.currentTimeMillis());
        out.addProperty("uuid", client.field_1724.method_5667().toString());
        out.addProperty("server", client.method_1558() == null ? "" : client.method_1558().field_3761);
        out.addProperty("dimension", world.method_27983().method_29177().toString());
        return out;
    }
    public JsonObject registry() {
        JsonObject out = base();
        if (registry == null) {
            registry = new JsonObject(); JsonArray blocks = new JsonArray();
            for (class_2680 state : class_2248.field_10651) {
                JsonObject entry = new JsonObject(); entry.addProperty("id", class_2248.method_9507(state));
                entry.addProperty("name", class_7923.field_41175.method_10221(state.method_26204()).toString());
                JsonObject props = new JsonObject(); state.method_11656().forEach((property, value) -> props.addProperty(property.method_11899(), propertyName(property,value)));
                entry.add("properties", props); blocks.add(entry);
            }
            registry.add("blocks", blocks); JsonArray biomes = new JsonArray();
            var biomeRegistry = world.method_30349().method_30530(class_7924.field_41236);
            for (var biome : biomeRegistry) { JsonObject entry = new JsonObject(); entry.addProperty("id", biomeRegistry.method_10206(biome)); entry.addProperty("name", biomeRegistry.method_10221(biome).toString()); JsonObject colors = new JsonObject();
                colors.addProperty("grass", biome.method_8711(0,0)); colors.addProperty("foliage", biome.method_8698()); colors.addProperty("water", biome.method_8687());
                entry.add("colors", colors); entry.addProperty("grassSample", "biome-origin-no-blending"); biomes.add(entry); }
            registry.add("biomes", biomes);
        }
        out.add("registry", registry); return out;
    }
    @SuppressWarnings({"rawtypes","unchecked"})
    private static String propertyName(class_2769 property, Comparable value) { return property.method_11901(value); }
    /** Export only the attached player's currently bound skin, never an arbitrary texture/path/URL. */
    public JsonObject skin(String resource) throws java.io.IOException {
        JsonObject out = base();
        var id = client.field_1724.method_52814().comp_1626();
        if (!id.toString().equals(resource)) throw new IllegalArgumentException("Visual skin changed; request a fresh frame");
        var texture = client.method_1531().method_4619(id);
        int previous = org.lwjgl.opengl.GL11.glGetInteger(org.lwjgl.opengl.GL11.GL_TEXTURE_BINDING_2D);
        try {
            texture.method_23207();
            int width = org.lwjgl.opengl.GL11.glGetTexLevelParameteri(org.lwjgl.opengl.GL11.GL_TEXTURE_2D,0,org.lwjgl.opengl.GL11.GL_TEXTURE_WIDTH);
            int height = org.lwjgl.opengl.GL11.glGetTexLevelParameteri(org.lwjgl.opengl.GL11.GL_TEXTURE_2D,0,org.lwjgl.opengl.GL11.GL_TEXTURE_HEIGHT);
            if (width != 64 || (height != 32 && height != 64)) throw new IllegalStateException("Unsupported native skin dimensions");
            try (class_1011 image = new class_1011(width,height,false)) {
                image.method_4327(0,false);
                byte[] png = image.method_24036();
                if (png.length > 65536) throw new IllegalStateException("Native skin PNG exceeds limit");
                out.addProperty("resource",resource);out.addProperty("mime","image/png");out.addProperty("width",width);out.addProperty("height",height);
                out.addProperty("base64",Base64.getEncoder().encodeToString(png));out.addProperty("source","same_java_client_skin_texture");
            }
        } finally { com.mojang.blaze3d.platform.GlStateManager._bindTexture(previous); }
        return out;
    }
    public JsonObject frame(int radius) {
        if (radius < 0 || radius > 4) throw new IllegalArgumentException("visual radius must be 0..4");
        JsonObject out = base(); var self = client.field_1724;
        out.add("self", entity(self)); out.addProperty("health", self.method_6032()); out.addProperty("food", self.method_7344().method_7586());
        out.addProperty("time", world.method_8532()); out.addProperty("raining", world.method_8419()); out.addProperty("thunder", world.method_8478(1));
        int cx = self.method_31477() >> 4, cz = self.method_31479() >> 4;
        JsonArray columns = new JsonArray();
        for (int z = cz-radius; z <= cz+radius; z++) for (int x = cx-radius; x <= cx+radius; x++) {
            var chunk = world.method_2935().method_2857(x, z, class_2806.field_12803, false);
            if (chunk != null) { JsonObject entry = new JsonObject(); entry.addProperty("x", x); entry.addProperty("z", z); entry.addProperty("revision", revisions.getOrDefault(key(x,z),0L)); columns.add(entry); }
        }
        out.add("columns", columns); out.addProperty("radius", radius);
        JsonArray entities = new JsonArray(); int count = 0; boolean truncated = false;
        for (var e : world.method_18112()) {
            if (e == self || Math.abs(e.method_31477()/16.0-cx) > radius+1 || Math.abs(e.method_31479()/16.0-cz) > radius+1) continue;
            if (count++ >= 256) { truncated = true; break; } entities.add(entity(e));
        }
        out.add("entities", entities); out.addProperty("entitiesTruncated", truncated);
        out.addProperty("source", "same_java_client_world");
        return out;
    }
    public JsonObject chunk(int x, int z, String expectedEpoch) {
        JsonObject out = base(); if (!epoch.equals(expectedEpoch)) throw new IllegalStateException("Visual epoch changed; discard old chunks");
        if (Math.abs(x-(client.field_1724.method_31477()>>4))>4 || Math.abs(z-(client.field_1724.method_31479()>>4))>4) throw new IllegalArgumentException("Visual chunk outside bounded client view");
        var column = world.method_2935().method_2857(x,z,class_2806.field_12803,false);
        if (column == null) throw new IllegalStateException("Visual chunk is not loaded; no world loading requested");
        out.addProperty("x",x);out.addProperty("z",z);out.addProperty("revision",revisions.getOrDefault(key(x,z),0L));
        out.addProperty("minY",world.method_31607());out.addProperty("height",world.method_31605());
        var buffer = new class_2540(Unpooled.buffer());
        try { for (var section : column.method_12006()) section.method_12257(buffer);
            if (buffer.readableBytes()>2*1024*1024) throw new IllegalStateException("Visual chunk too large");
            byte[] bytes = new byte[buffer.readableBytes()];buffer.readBytes(bytes);out.addProperty("sections",Base64.getEncoder().encodeToString(bytes));
        } finally { buffer.release(); }
        var light = world.method_2935().method_12130();
        JsonArray sky = new JsonArray(), block = new JsonArray();
        for(int i=0;i<column.method_12006().length;i++) {
            var pos = class_4076.method_18676(x,world.method_32891()+i,z);
            sky.add(nibbles(light.method_15562(class_1944.field_9284).method_15544(pos), class_1944.field_9284, x, world.method_32891()+i, z));
            block.add(nibbles(light.method_15562(class_1944.field_9282).method_15544(pos), class_1944.field_9282, x, world.method_32891()+i, z));
        }
        out.add("skyLight",sky);out.add("blockLight",block);
        out.addProperty("blockEntitiesAvailable",false); // Explicit until NBT/component renderer support is wired.
        return out;
    }
    private JsonElement nibbles(class_2804 value, class_1944 type, int cx, int cy, int cz) {
        if(value != null) return new JsonPrimitive(Base64.getEncoder().encodeToString(value.method_12137()));
        // Missing storage is not zero sky light: ask the native propagation engine.
        byte[] bytes = new byte[2048];
        for(int y=0;y<16;y++) for(int z=0;z<16;z++) for(int x=0;x<16;x++) {
            int i=(y<<8)|(z<<4)|x, level=world.method_8314(type,new class_2338((cx<<4)+x,(cy<<4)+y,(cz<<4)+z));
            bytes[i>>1] |= (byte)((level&15)<<((i&1)*4));
        }
        return new JsonPrimitive(Base64.getEncoder().encodeToString(bytes));
    }
    private JsonObject entity(class_1297 e) {
        JsonObject out = new JsonObject(); out.addProperty("id",e.method_5628());out.addProperty("uuid",e.method_5667().toString());
        out.addProperty("name",class_1299.method_5890(e.method_5864()).toString());out.addProperty("username",e.method_5477().getString());
        out.add("position",gson.toJsonTree(new double[]{e.method_23317(),e.method_23318(),e.method_23321()}));
        out.addProperty("yaw",e.method_36454());out.addProperty("pitch",e.method_36455());out.addProperty("headYaw",e.method_5791());
        if(e instanceof class_742 player) { var skin=player.method_52814();out.addProperty("skinResource",skin.comp_1626().toString());out.addProperty("skinModel",skin.comp_1629().name().equals("SLIM")?"slim":"classic"); }
        out.addProperty("width",e.method_17681());out.addProperty("height",e.method_17682());out.addProperty("eyeHeight",e.method_18381(e.method_18376()));
        out.addProperty("pose",e.method_18376().name());out.addProperty("onGround",e.method_24828());out.addProperty("sneaking",e.method_5715());out.addProperty("sprinting",e.method_5624());out.addProperty("burning",e.method_5809());
        var v=e.method_18798();out.add("velocity",gson.toJsonTree(new double[]{v.field_1352,v.field_1351,v.field_1350}));
        if(e instanceof class_1309 living) {
            out.addProperty("hurtTime",living.field_6235);out.addProperty("swingProgress",living.field_6251);out.addProperty("usingItem",living.method_6115());
            JsonArray equipment=new JsonArray();for(var slot:List.of(class_1304.field_6173,class_1304.field_6171,class_1304.field_6166,class_1304.field_6172,class_1304.field_6174,class_1304.field_6169)) {
                var item=living.method_6118(slot);if(item.method_7960()){equipment.add(JsonNull.INSTANCE);continue;}
                JsonObject row=new JsonObject();row.addProperty("name",class_7923.field_41178.method_10221(item.method_7909()).toString());row.addProperty("count",item.method_7947());row.addProperty("displayName",item.method_7964().getString());equipment.add(row);
            }out.add("equipment",equipment);
        }
        return out;
    }
}
