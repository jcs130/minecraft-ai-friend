package org.afuhome.appearance;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import java.util.Base64;

/** Offline adapter of the existing public YSM catalog. Never connects to a game or model service. */
public final class MaidModelExport {
 public static void main(String[] args)throws Exception {
  if(args.length!=2)throw new IllegalArgumentException("models.json output.json");
  Path out=Path.of(args[1]);if(Files.exists(out))throw new IllegalArgumentException("Fresh output required");
  var catalog=new ModelCatalog(Path.of(args[0]),"2.6.5");catalog.scan();catalog.scan();
  var geometry=BedrockPack.class.getDeclaredMethod("geometry",JsonObject.class,String.class,float.class,float.class);geometry.setAccessible(true);
  var animations=BedrockPack.class.getDeclaredMethod("readAnimations",JsonObject.class,String.class);animations.setAccessible(true);
  List<Map<String,Object>> results=new ArrayList<>();Map<String,String> rejected=new TreeMap<>();
  for(String id:catalog.catalog().keySet())try{
   var asset=catalog.get(id);var bundle=BedrockPack.bundle(asset);
   var raw=JsonParser.parseString(new String(BedrockPack.file(bundle,bundle.get("model").getAsString()),java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
   BedrockPack.validateGeometry(raw);
   var spec=JsonParser.parseString(new String(BedrockPack.file(bundle,"ysm.json"),java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
   if(bundle.has("controllers")&&!bundle.getAsJsonArray("controllers").isEmpty())throw new IllegalArgumentException("YSM_BEDROCK_CUSTOM_CONTROLLERS_UNSUPPORTED");
   var props=spec.getAsJsonObject("properties");
   float h=props.has("height_scale")?props.get("height_scale").getAsFloat():1f,w=props.has("width_scale")?props.get("width_scale").getAsFloat():1f;
   if(!Float.isFinite(h)||!Float.isFinite(w)||h<.1f||w<.1f||h>4||w>4)throw new IllegalArgumentException("YSM_SCALE_INVALID");
   String prefix="qdmaid.ysm_"+asset.sha256().substring(0,16);
   Map<String,String> textures=new TreeMap<>();for(String texture:asset.textures()){
    byte[] png=BedrockPack.file(bundle,bundle.getAsJsonObject("textures").get(texture).getAsString());BedrockPack.validateTexture(png,raw);textures.put(texture,Base64.getEncoder().encodeToString(png));
   }
   results.add(Map.of("modelId",id,"sourceSha256",asset.sha256(),"geometry",geometry.invoke(null,raw,prefix,h,w),"animations",animations.invoke(null,bundle,prefix),"textures",textures,"metadata",spec.getAsJsonObject("metadata"),"heightScale",h,"widthScale",w));
  }catch(Exception error){rejected.put(id,error.getCause()!=null?String.valueOf(error.getCause().getMessage()):String.valueOf(error.getMessage()));}
  Files.writeString(out,new Gson().toJson(Map.of("schema",1,"models",results,"rejected",rejected)),StandardOpenOption.CREATE_NEW);
  System.out.println(new Gson().toJson(Map.of("converted",results.size(),"rejected",rejected,"productionChanged",false)));
 }
}
