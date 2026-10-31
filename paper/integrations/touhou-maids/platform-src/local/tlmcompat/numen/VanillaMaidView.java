package local.tlmcompat.numen;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import net.minecraft.ChatFormatting;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.contents.TranslatableContents;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.*;
import net.minecraft.world.item.*;
import net.minecraft.world.item.component.ItemLore;

/** Vanilla wire appearances only; original mod entities, items, names and ownership stay unchanged. */
final class VanillaMaidView {
    private static final Map<String,String> ZH=translations();
    private static Map<String,String> translations(){
        try(var in=VanillaMaidView.class.getResourceAsStream("/qiandengji-tlm-zh.json")){
            if(in==null)return Map.of();
            var json=JsonParser.parseString(new String(in.readAllBytes(),StandardCharsets.UTF_8)).getAsJsonObject();
            Map<String,String> values=new HashMap<>();for(var row:json.entrySet())if(row.getValue().isJsonPrimitive())values.put(row.getKey(),row.getValue().getAsString());
            return Map.copyOf(values);
        }catch(Exception missing){return Map.of();}
    }
    static String plain(Component value){
        if(value.getContents() instanceof TranslatableContents text&&ZH.containsKey(text.getKey())){
            try{
                Object[] args=Arrays.stream(text.getArgs()).map(arg->arg instanceof Component c?plain(c):arg).toArray();
                String result=String.format(Locale.ROOT,ZH.get(text.getKey()),args);
                for(Component sibling:value.getSiblings())result+=plain(sibling);return result;
            }catch(IllegalFormatException unsupported){/* Retain the native name if its format is unsupported. */}
        }
        return value.getString();
    }
    static String kind(Entity entity){
        if(entity==null)return "";var key=BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType());
        return key.getNamespace().equals("touhou_little_maid")?key.getPath():"";
    }
    private static boolean bedrock(ServerPlayer player){
        if(player==null)return false;
        var plugin=org.bukkit.Bukkit.getPluginManager().getPlugin("floodgate");if(plugin==null||!plugin.isEnabled())return false;
        try{
            Class<?> type=Class.forName("org.geysermc.floodgate.api.FloodgateApi",false,plugin.getClass().getClassLoader());
            Object api=type.getMethod("getInstance").invoke(null);return Boolean.TRUE.equals(type.getMethod("isFloodgatePlayer",UUID.class).invoke(api,player.getUUID()));
        }catch(ReflectiveOperationException unavailable){return false;}
    }
    static EntityType<?> type(Entity entity,ServerPlayer viewer){
        return switch(kind(entity)){
            case "maid" -> bedrock(viewer)?EntityType.VILLAGER:EntityType.ALLAY; // Preserve the existing Geyser original-model hook.
            case "fairy" -> EntityType.VEX;
            case "danmaku" -> EntityType.SMALL_FIREBALL;
            default -> entity instanceof LivingEntity?EntityType.VILLAGER:EntityType.SNOWBALL;
        };
    }
    static Component name(Entity entity){
        String kind=kind(entity);if(!Set.of("maid","fairy").contains(kind))return null;
        String custom=entity.hasCustomName()?plain(entity.getCustomName()):"";
        if(custom.length()>48)custom=custom.substring(0,48);
        return kind.equals("fairy")?Component.literal("[敌对妖精] "+(custom.isBlank()?"弹幕妖精":custom)).withStyle(ChatFormatting.RED):
            Component.literal("[女仆] "+(custom.isBlank()?"女仆伙伴":custom)).withStyle(ChatFormatting.AQUA);
    }
    static int metadataPrefix(Entity entity){
        // The selected Java replacements share Entity/LivingEntity/Mob only. Never reinterpret native age/owner/task slots.
        return entity instanceof LivingEntity?15:7;
    }
    static ItemStack item(ItemStack source){
        var id=BuiltInRegistries.ITEM.getKey(source.getItem());
        if(!id.getNamespace().equals("touhou_little_maid"))return null;
        Item icon=switch(id.getPath()){
            case "smart_slab_init","smart_slab_empty","smart_slab_has_maid" -> Items.AMETHYST_SHARD;
            case "hakurei_gohei" -> Items.BLAZE_ROD;
            case "maid_bed" -> Items.WHITE_BED;
            default -> id.getPath().contains("scroll")?Items.PAPER:Items.BOOK;
        };
        var result=new ItemStack(icon,Math.min(64,source.getCount()));
        String label=plain(source.getHoverName());if(label.equals(source.getDescriptionId()))label="女仆道具";
        result.set(DataComponents.CUSTOM_NAME,Component.literal(label));
        result.set(DataComponents.LORE,new ItemLore(List.of(Component.literal("女仆道具 · 原物品与效果保留").withStyle(ChatFormatting.GRAY),
            Component.literal("右键女仆打开原版菜单；/qdmaid help 查看使用方法").withStyle(ChatFormatting.GRAY))));
        return result;
    }
}
