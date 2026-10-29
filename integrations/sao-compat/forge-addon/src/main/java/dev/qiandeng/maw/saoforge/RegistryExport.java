package dev.qiandeng.maw.saoforge;

import com.google.gson.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.properties.Property;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Export this JVM's actual numeric registries; never reuse another boot's IDs. */
final class RegistryExport {
    @SuppressWarnings({"rawtypes", "unchecked"})
    private static String property(Property key, Comparable value) { return key.getName(value); }
    static void write(MinecraftServer server, String epoch) {
        try {
            Path directory=server.getServerDirectory().toPath().resolve("maw-sao/registry").resolve(epoch);
            Files.createDirectories(directory);
            int states=0,items=0,entities=0;
            try(var output=Files.newBufferedWriter(directory.resolve("states.jsonl"),StandardCharsets.UTF_8,StandardOpenOption.CREATE_NEW)) {
                for(var state:Block.BLOCK_STATE_REGISTRY) {
                    JsonObject row=new JsonObject();row.addProperty("id",Block.getId(state));
                    row.addProperty("name",BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
                    row.addProperty("blockId",BuiltInRegistries.BLOCK.getId(state.getBlock()));
                    row.addProperty("defaultStateId",Block.getId(state.getBlock().defaultBlockState()));
                    row.addProperty("canOcclude",state.canOcclude());
                    try{row.addProperty("hardness",state.getDestroySpeed(EmptyBlockGetter.INSTANCE,BlockPos.ZERO));}catch(RuntimeException contextual){row.add("hardness",JsonNull.INSTANCE);}
                    JsonObject props=new JsonObject();for(var entry:state.getValues().entrySet())props.addProperty(entry.getKey().getName(),property(entry.getKey(),entry.getValue()));row.add("properties",props);
                    row.addProperty("isAir",state.isAir());row.addProperty("shapeContext","empty_block_getter_not_live_world_observation");
                    try {
                        var shape=state.getCollisionShape(EmptyBlockGetter.INSTANCE,BlockPos.ZERO);
                        JsonArray boxes=new JsonArray();for(var box:shape.toAabbs()) {
                            JsonArray bounds=new JsonArray();for(double n:new double[]{box.minX,box.minY,box.minZ,box.maxX,box.maxY,box.maxZ})bounds.add(n);boxes.add(bounds);
                        }row.add("collisionShapes",boxes);row.addProperty("shapeAvailable",true);
                    }catch(RuntimeException contextual){row.add("collisionShapes",JsonNull.INSTANCE);row.addProperty("shapeAvailable",false);row.addProperty("shapeUnavailableReason","requires_live_block_context");}
                    output.write(row.toString());output.newLine();states++;
                }
            }
            try(var output=Files.newBufferedWriter(directory.resolve("items.jsonl"),StandardCharsets.UTF_8,StandardOpenOption.CREATE_NEW)) {
                for(var item:BuiltInRegistries.ITEM){JsonObject row=new JsonObject();row.addProperty("id",BuiltInRegistries.ITEM.getId(item));row.addProperty("name",BuiltInRegistries.ITEM.getKey(item).toString());row.addProperty("descriptionId",item.getDescriptionId());row.addProperty("stackSize",item.getMaxStackSize());output.write(row.toString());output.newLine();items++;}
            }
            try(var output=Files.newBufferedWriter(directory.resolve("entities.jsonl"),StandardCharsets.UTF_8,StandardOpenOption.CREATE_NEW)) {
                for(var entity:BuiltInRegistries.ENTITY_TYPE){JsonObject row=new JsonObject();row.addProperty("id",BuiltInRegistries.ENTITY_TYPE.getId(entity));row.addProperty("name",BuiltInRegistries.ENTITY_TYPE.getKey(entity).toString());row.addProperty("category",entity.getCategory().getName());output.write(row.toString());output.newLine();entities++;}
            }
            JsonObject record=new JsonObject();record.addProperty("schemaVersion",1);record.addProperty("minecraft","1.20.1");record.addProperty("forge","47.4.10");record.addProperty("serverEpoch",epoch);record.addProperty("processId",ProcessHandle.current().pid());record.addProperty("states",states);record.addProperty("items",items);record.addProperty("entities",entities);record.addProperty("directory",directory.toString());record.addProperty("observedAt",java.time.Instant.now().toString());
            Files.writeString(directory.getParent().resolve("current.json"),record.toString(),StandardCharsets.UTF_8);
            JsonArray bindings=new JsonArray();
            for(String name:List.of("dev.ftb.mods.ftbquests.quest.QuestObject","dev.ftb.mods.ftbquests.quest.QuestObjectBase","net.minecraft.network.chat.Component")) {
                JsonObject binding=new JsonObject();binding.addProperty("class",name);
                try {
                    Class<?> type=Class.forName(name);binding.addProperty("source",String.valueOf(type.getProtectionDomain().getCodeSource()));
                    JsonArray methods=new JsonArray();for(var method:type.getDeclaredMethods())if(method.getParameterCount()==0){methods.add(method.getName()+":"+method.getReturnType().getName());}binding.add("zeroArgumentMethods",methods);
                }catch(Throwable unavailable){binding.addProperty("error",unavailable.getClass().getName());}
                bindings.add(binding);
            }
            Files.writeString(directory.getParent().resolve("runtime-bindings.json"),bindings.toString(),StandardCharsets.UTF_8);
            org.slf4j.LoggerFactory.getLogger("maw-sao").info("[maw-sao] Native registries ready: states={} items={} entities={}",states,items,entities);
        }catch(Exception error){throw new IllegalStateException("Native registry export failed; bridge must not guess numeric IDs",error);}
    }
}
