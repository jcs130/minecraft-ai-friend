package org.afuhome.appearance;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.GZIPInputStream;
import javax.imageio.ImageIO;
import org.geysermc.geyser.api.skin.*;

/** Original geometry/UV/PNG, delivered as a Bedrock player skin. No substitute model. */
record BedrockModel(String key, Skin skin, SkinGeometry geometry, int bones, int cubes) {
    static BedrockModel convert(ModelCatalog.Asset asset,String texture) throws Exception {
        if(asset==null || !asset.available() || !asset.textures().contains(texture))throw new IOException("YSM_BEDROCK_SOURCE_UNAVAILABLE");
        byte[] raw;
        try(var in=new GZIPInputStream(new ByteArrayInputStream(asset.gzip()))) {
            raw=in.readNBytes(ModelCatalog.RAW_LIMIT+1);
            if(raw.length>ModelCatalog.RAW_LIMIT)throw new IOException("YSM_BEDROCK_BUNDLE_BUDGET");
        }
        JsonObject bundle=JsonParser.parseString(new String(raw,StandardCharsets.UTF_8)).getAsJsonObject();
        JsonObject model=JsonParser.parseString(new String(file(bundle,bundle.get("model").getAsString()),StandardCharsets.UTF_8)).getAsJsonObject();
        JsonArray geometries=model.getAsJsonArray("minecraft:geometry");
        if(geometries==null || geometries.size()!=1)throw new IOException("YSM_BEDROCK_GEOMETRY_UNSUPPORTED");
        JsonObject geometry=geometries.get(0).getAsJsonObject(),description=geometry.getAsJsonObject("description");
        JsonArray bones=geometry.getAsJsonArray("bones");
        if(bones==null || bones.size()<1 || bones.size()>512)throw new IOException("YSM_BEDROCK_BONE_BUDGET");
        Set<String> names=new HashSet<>();Map<String,String> parents=new HashMap<>();int cubes=0;
        for(JsonElement element:bones) {
            JsonObject bone=element.getAsJsonObject();String name=bone.get("name").getAsString();
            if(name.isEmpty() || name.length()>96 || !names.add(name))throw new IOException("YSM_BEDROCK_BONE_INVALID");
            if(bone.has("parent"))parents.put(name,bone.get("parent").getAsString());
            if(bone.has("cubes"))cubes+=bone.getAsJsonArray("cubes").size();
        }
        if(cubes>4096)throw new IOException("YSM_BEDROCK_CUBE_BUDGET");
        for(String name:names) {
            Set<String> path=new HashSet<>();String current=name;
            while(current!=null) { if(!names.contains(current) || !path.add(current))throw new IOException("YSM_BEDROCK_BONE_HIERARCHY_INVALID");current=parents.get(current); }
        }
        byte[] png=file(bundle,bundle.getAsJsonObject("textures").get(texture).getAsString());
        // Geyser's ImageData.of(byte[]) infers these exact dimensions. Never resize UVs.
        var header=java.nio.ByteBuffer.wrap(png);int width=header.getInt(16),height=header.getInt(20);
        if(!((width==64 && (height==32 || height==64)) || (width==128 && (height==64 || height==128))))throw new IOException("YSM_BEDROCK_SKIN_DIMENSIONS_UNSUPPORTED");
        if(description.get("texture_width").getAsInt()!=width || description.get("texture_height").getAsInt()!=height)throw new IOException("YSM_BEDROCK_UV_DIMENSIONS_MISMATCH");
        var image=ImageIO.read(new ByteArrayInputStream(png));
        if(image==null || image.getWidth()!=width || image.getHeight()!=height)throw new IOException("YSM_BEDROCK_PNG_INVALID");
        byte[] rgba=new byte[width*height*4];int index=0;
        for(int y=0;y<height;y++)for(int x=0;x<width;x++) {
            int pixel=image.getRGB(x,y);rgba[index++]=(byte)(pixel>>>16);rgba[index++]=(byte)(pixel>>>8);rgba[index++]=(byte)pixel;rgba[index++]=(byte)(pixel>>>24);
        }
        String key=asset.sha256()+":"+texture;
        String id="geometry.humanoid.custom.ysm_"+ModelCatalog.sha(key.getBytes(StandardCharsets.UTF_8)).substring(0,24);
        // Only the namespace identifier changes; every source bone/cube/UV remains intact.
        description.addProperty("identifier",id);
        String geometryJson=new Gson().toJson(model);
        if(geometryJson.length()>512*1024)throw new IOException("YSM_BEDROCK_GEOMETRY_BYTE_BUDGET");
        JsonObject defaults=new JsonObject();defaults.addProperty("default",id);JsonObject patch=new JsonObject();patch.add("geometry",defaults);
        return new BedrockModel(key,new Skin("ysm:"+key,rgba),new SkinGeometry(patch.toString(),geometryJson),bones.size(),cubes);
    }
    private static byte[] file(JsonObject bundle,String name) throws Exception {
        JsonObject file=bundle.getAsJsonObject("files").getAsJsonObject(name);
        byte[] bytes=Base64.getDecoder().decode(file.get("base64").getAsString());
        if(bytes.length!=file.get("bytes").getAsInt() || !ModelCatalog.sha(bytes).equals(file.get("sha256").getAsString()))throw new IOException("YSM_BEDROCK_SOURCE_HASH_MISMATCH");
        return bytes;
    }
}
