package dev.qiandeng.maw;

import com.google.gson.*;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.component.DataComponentType;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Read the installed mods' real Chinese handbook resources without loading
 * client screens on a dedicated server. No invented recipes or replacement items. */
public final class BedrockBookBridge {
    private static final Map<String,List<JsonObject>> BOOKS=new HashMap<>();
    private BedrockBookBridge() {}
    static void register() {
        NeoForge.EVENT_BUS.addListener((PlayerInteractEvent.RightClickItem e)->{
            if(e.getHand()!=InteractionHand.MAIN_HAND||!(e.getEntity() instanceof ServerPlayer p)||!PlayerAuthBridge.authenticated(p))return;
            String kind=kind(p.getMainHandItem());
            if(kind.isEmpty()){
                String id=BuiltInRegistries.ITEM.getKey(p.getMainHandItem().getItem()).toString();
                if(id.startsWith("touhou_little_maid:smart_slab"))kind="maid_menu";
            }
            if(!kind.isEmpty()&&request(p,kind)){e.setCanceled(true);e.setCancellationResult(InteractionResult.SUCCESS);}
        });
        NeoForge.EVENT_BUS.addListener((PlayerInteractEvent.RightClickBlock e)->{
            if(e.getHand()!=InteractionHand.MAIN_HAND||!(e.getEntity() instanceof ServerPlayer p)||!PlayerAuthBridge.authenticated(p))return;
            String kind=kind(p.getMainHandItem());
            // Soul slabs retain the original useOn: solid top face spawns/stores
            // the real owned maid, consumes the actual slab and applies its limit.
            if(!kind.isEmpty()&&request(p,kind)){e.setCanceled(true);e.setCancellationResult(InteractionResult.SUCCESS);}
        });
    }
    private static boolean request(ServerPlayer p,String kind) {
        try{return (Boolean)Class.forName("dev.qiandeng.maw.numenserver.BedrockMenus").getMethod("openMenu",ServerPlayer.class,String.class).invoke(null,p,kind);}
        catch(ClassNotFoundException optional){return false;}
        catch(ReflectiveOperationException e){throw new IllegalStateException("bedrock_book_menu_unavailable",e);}
    }
    @SuppressWarnings("unchecked")
    private static String kind(ItemStack stack) {
        String id=BuiltInRegistries.ITEM.getKey(stack.getItem()).toString();
        if(id.equals("ars_nouveau:worn_notebook"))return "book_ars";
        if(id.equals("patchouli:guide_book")){
            var type=(DataComponentType<ResourceLocation>)BuiltInRegistries.DATA_COMPONENT_TYPE.get(ResourceLocation.parse("patchouli:book"));
            if(type!=null&&ResourceLocation.parse("touhou_little_maid:memorizable_gensokyo").equals(stack.get(type)))return "book_maid";
        }
        return "";
    }
    private static JsonObject json(Path path)throws java.io.IOException {
        return JsonParser.parseString(Files.readString(path,StandardCharsets.UTF_8)).getAsJsonObject();
    }
    private static String plain(String raw,JsonObject language) {
        String text=language.has(raw)?language.get(raw).getAsString():raw;
        return text.replace("$(br2)","\n\n").replace("$(br)","\n").replaceAll("\\$\\([^)]*\\)","");
    }
    private static String text(JsonObject o,String key,JsonObject lang){return o.has(key)&&o.get(key).isJsonPrimitive()?plain(o.get(key).getAsString(),lang):"";}
    private static Path resource(String mod,String... parts) {
        var file=net.neoforged.fml.ModList.get().getModFileById(mod);
        if(file==null)throw new IllegalArgumentException("book_mod_unavailable");return file.getFile().findResource(parts);
    }
    private static List<JsonObject> load(String book) {
        try {
            List<JsonObject> result=new ArrayList<>();
            if(book.equals("book_maid")){
                JsonObject lang=json(resource("touhou_little_maid","assets","touhou_little_maid","lang","zh_cn.json"));
                Path entries=resource("touhou_little_maid","assets","touhou_little_maid","patchouli_books","memorizable_gensokyo","en_us","entries");
                try(var paths=Files.walk(entries)){
                    for(Path p:paths.filter(f->f.toString().endsWith(".json")).sorted().toList()){
                        JsonObject src=json(p),row=new JsonObject();StringBuilder body=new StringBuilder();
                        if(src.has("pages"))for(JsonElement page:src.getAsJsonArray("pages")){
                            var s=page.getAsJsonObject();for(String key:List.of("title","text")){String t=text(s,key,lang);if(!t.isBlank())body.append(t).append("\n\n");}
                            if(s.has("item"))body.append("物品：").append(text(s,"item",lang)).append("\n");
                            for(String key:List.of("recipe","recipe2","recipe_id"))if(s.has(key))body.append("原生配方：").append(text(s,key,lang)).append("\n");
                        }
                        row.addProperty("id",entries.relativize(p).toString().replace('\\','/').replace(".json",""));
                        row.addProperty("name",text(src,"name",lang));row.addProperty("text",body.toString());result.add(row);
                    }
                }
            }else if(book.equals("book_ars")){
                JsonObject lang=json(resource("ars_nouveau","assets","ars_nouveau","lang","zh_cn.json"));
                for(var e:lang.entrySet())if(e.getKey().startsWith("ars_nouveau.page.")){
                    String id=e.getKey().substring("ars_nouveau.page.".length()),title=e.getValue().getAsString();StringBuilder body=new StringBuilder();
                    if(title.length()>60){body.append(title);title=lang.has("item.ars_nouveau."+id)?lang.get("item.ars_nouveau."+id).getAsString():lang.has("block.ars_nouveau."+id)?lang.get("block.ars_nouveau."+id).getAsString():id;}
                    for(int n=1;n<=32;n++){String key="ars_nouveau.page"+n+"."+id;if(lang.has(key))body.append("\n\n").append(plain(key,lang));}
                    if(body.isEmpty())continue;JsonObject row=new JsonObject();row.addProperty("id",id);row.addProperty("name",title);row.addProperty("text",body.toString().strip());result.add(row);
                }
            }else throw new IllegalArgumentException("unknown_book");
            result.sort(Comparator.comparing(row->row.get("name").getAsString()));return List.copyOf(result);
        }catch(java.io.IOException e){throw new IllegalStateException("native_book_resource_unavailable",e);}
    }
    public static JsonObject read(ServerPlayer p,JsonObject args) {
        PlayerAuthBridge.requireAuthenticated(p);String book=kind(p.getMainHandItem());
        if(book.isEmpty())throw new IllegalArgumentException("hold_native_guide_book");
        if(!Set.of("offset","entryId").containsAll(args.keySet()))throw new IllegalArgumentException("unsupported_book_argument");
        List<JsonObject> entries=BOOKS.computeIfAbsent(book,BedrockBookBridge::load);JsonObject out=new JsonObject();
        out.addProperty("ok",true);out.addProperty("bookId",book);out.addProperty("title",book.equals("book_maid")?"车万女仆 · 记忆中的幻想乡":"新生魔艺 · 旧笔记");
        out.addProperty("source","installed_mod_chinese_resources");out.addProperty("total",entries.size());
        if(args.has("entryId")){
            String id=args.get("entryId").getAsString();out.add("entry",entries.stream().filter(row->row.get("id").getAsString().equals(id)).findFirst().orElseThrow(()->new IllegalArgumentException("book_entry_missing")).deepCopy());
        }else{
            int offset=args.has("offset")?args.get("offset").getAsInt():0;if(offset<0||offset>entries.size())throw new IllegalArgumentException("book_page_out_of_range");
            JsonArray rows=new JsonArray();entries.stream().skip(offset).limit(16).forEach(row->{JsonObject v=new JsonObject();v.add("id",row.get("id"));v.add("name",row.get("name"));rows.add(v);});out.add("entries",rows);out.addProperty("offset",offset);out.addProperty("hasMore",offset+rows.size()<entries.size());
        }
        return out;
    }
}
