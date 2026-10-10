package org.afuhome.appearance;

import com.google.gson.*;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;

/** Convert public plaintext YSM folders/ZIPs into hash-addressed browser bundles.
 * No HTTP service, archive extraction, encrypted-model decryption, or auth-directory export. */
final class ModelCatalog {
    static final int RAW_LIMIT=8*1024*1024, ZIP_LIMIT=2*1024*1024;
    private static final Gson JSON=new Gson();
    record Asset(String id,String sha256,byte[] gzip,List<String> textures,String reason) {
        boolean available(){return gzip!=null;}
    }
    private final Path config;
    private volatile Map<String,Asset> assets=Map.of();
    private final Map<String,String> fingerprints=new HashMap<>();
    private final Map<String,String> observed=new HashMap<>();
    private volatile String revision="";
    String revision(){return revision;}
    void invalidate(){assets=Map.of();revision="";}
    ModelCatalog(Path config){this.config=config;}
    Asset get(String id){return assets.get(id);}
    Map<String,List<String>> catalog(){Map<String,List<String>> out=new TreeMap<>();assets.forEach((id,a)->{if(a.available())out.put(id,a.textures);});return out;}
    synchronized void scan() throws Exception {
        if(!Files.isRegularFile(config)){invalidate();return;}
        JsonObject options=JsonParser.parseString(Files.readString(config)).getAsJsonObject();
        Path root=Path.of(options.get("publicModelRoot").getAsString()).toRealPath();
        if(!root.isAbsolute() || !root.getFileName().toString().equals("custom"))throw new IOException("YSM_PUBLIC_CUSTOM_ROOT_REQUIRED");
        List<Path> found;
        try(var walk=Files.walk(root,16)){found=walk.limit(4097).toList();}
        if(found.size()>4096)throw new IOException("YSM_SCAN_BUDGET");
        Map<String,Asset> next=new TreeMap<>();long bytes=0;
        for(Path p:found){
            if(Files.isSymbolicLink(p))throw new IOException("YSM_SYMLINK_REJECTED");
            if(!Files.isRegularFile(p))continue;
            String file=p.getFileName().toString(), id;
            boolean folder=file.equals("ysm.json"), zip=file.toLowerCase(Locale.ROOT).endsWith(".zip"), encrypted=file.toLowerCase(Locale.ROOT).endsWith(".ysm");
            if(!folder && !zip && !encrypted)continue;
            id=folder?p.getParent().getFileName().toString():file.substring(0,file.lastIndexOf('.'));
            if(!validId(id))continue;
            if(next.size()>=64)throw new IOException("YSM_MODEL_COUNT_BUDGET");
            Asset asset;
            try {
                if(encrypted)asset=new Asset(id,null,null,List.of(),"YSM_ENCRYPTED_SOURCE_REQUIRED");
                else {
                    Map<String,byte[]> files=folder?folder(p.getParent()):archive(p);
                    String fingerprint=digest(files);
                    Asset previous=assets.get(id);
                    if(!fingerprint.equals(observed.put(id,fingerprint))) {
                        if(previous!=null)next.put(id,previous);
                        continue; // Require two stable scans while an uploader is still writing files.
                    }
                    if(fingerprint.equals(fingerprints.get(id)) && previous!=null)asset=previous;
                    else {asset=convert(id,files);fingerprints.put(id,fingerprint);}
                }
            } catch(Exception error){asset=new Asset(id,null,null,List.of(),error.getMessage()!=null && error.getMessage().startsWith("YSM_")?error.getMessage():"YSM_MODEL_INVALID");}
            if(next.containsKey(id))asset=new Asset(id,null,null,List.of(),"YSM_DUPLICATE_MODEL_ID");
            if(asset.gzip!=null){bytes+=asset.gzip.length;if(bytes>32*1024*1024)throw new IOException("YSM_CATALOG_BYTE_BUDGET");}
            next.put(id,asset);
        }
        assets=Map.copyOf(next); // Removal/replacement becomes visible atomically; old transfers keep immutable bytes.
        revision=sha(JSON.toJson(next.values().stream().map(a->a.id+":"+a.sha256+":"+a.reason).toList()).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    static boolean validId(String id){return id!=null && id.length()<=96 && id.matches("[\\p{L}\\p{N}_./-]+") && !id.contains("..") && !id.startsWith("/");}
    private static boolean safe(String name){return name!=null && name.length()<=256 && !name.startsWith("/") && !name.contains("\\") && !name.contains(":") && !Arrays.asList(name.split("/",-1)).contains("..");}
    private static byte[] read(InputStream in,int limit) throws IOException {byte[] bytes=in.readNBytes(limit+1);if(bytes.length>limit)throw new IOException("YSM_FILE_BYTE_BUDGET");return bytes;}
    private static Map<String,byte[]> folder(Path root) throws IOException {
        Map<String,byte[]> out=new TreeMap<>();long size=0;
        List<Path> list;try(var walk=Files.walk(root,8)){list=walk.limit(257).toList();}
        if(list.size()>256)throw new IOException("YSM_FILE_COUNT_BUDGET");
        for(Path p:list){if(Files.isSymbolicLink(p))throw new IOException("YSM_SYMLINK_REJECTED");if(!Files.isRegularFile(p))continue;
            String relative=root.relativize(p).toString().replace('\\','/');if(!safe(relative))throw new IOException("YSM_FILE_PATH_INVALID");
            long n=Files.size(p);if(n>RAW_LIMIT || (size+=n)>RAW_LIMIT)throw new IOException("YSM_MODEL_BYTE_BUDGET");
            try(var in=Files.newInputStream(p)){out.put(relative,read(in,RAW_LIMIT));}
        }return out;
    }
    private static Map<String,byte[]> archive(Path path) throws IOException {
        if(Files.size(path)>RAW_LIMIT)throw new IOException("YSM_ARCHIVE_BYTE_BUDGET");
        Map<String,byte[]> out=new TreeMap<>();long size=0;int count=0;
        try(var in=new ZipInputStream(Files.newInputStream(path))){ZipEntry entry;
            while((entry=in.getNextEntry())!=null){if(++count>256)throw new IOException("YSM_FILE_COUNT_BUDGET");
                String name=entry.getName();if(!safe(name))throw new IOException("YSM_FILE_PATH_INVALID");if(entry.isDirectory())continue;
                byte[] bytes=read(in,RAW_LIMIT);if((size+=bytes.length)>RAW_LIMIT)throw new IOException("YSM_MODEL_BYTE_BUDGET");
                if(out.put(name,bytes)!=null)throw new IOException("YSM_DUPLICATE_FILE");
            }
        }
        // A conventional ZIP may contain one enclosing model directory.
        if(!out.containsKey("ysm.json")){
            List<String> definitions=out.keySet().stream().filter(n->n.endsWith("/ysm.json")).toList();
            if(definitions.size()!=1)throw new IOException("YSM_DEFINITION_MISSING");
            String prefix=definitions.getFirst().substring(0,definitions.getFirst().length()-8);
            Map<String,byte[]> stripped=new TreeMap<>();for(var entry:out.entrySet())if(entry.getKey().startsWith(prefix))stripped.put(entry.getKey().substring(prefix.length()),entry.getValue());out=stripped;
        }return out;
    }
    private static byte[] require(Map<String,byte[]> files,String path) throws IOException {
        if(!safe(path) || !files.containsKey(path))throw new IOException("YSM_REFERENCED_FILE_MISSING");return files.get(path);
    }
    private static JsonObject json(byte[] bytes){return JsonParser.parseString(new String(bytes,java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();}
    static Asset convert(String id,Map<String,byte[]> files) throws Exception {
        byte[] definition=require(files,"ysm.json");JsonObject spec=json(definition);
        if(spec.get("spec").getAsInt()!=2)throw new IOException("YSM_SPEC_UNSUPPORTED");
        // The public custom directory is intentionally separate from licensed/auth-only models.
        if(!spec.has("properties") || !spec.getAsJsonObject("properties").has("free") || !spec.getAsJsonObject("properties").get("free").getAsBoolean())throw new IOException("YSM_PUBLIC_SHARE_PERMISSION_REQUIRED");
        JsonObject player=spec.getAsJsonObject("files").getAsJsonObject("player");
        String model=player.getAsJsonObject("model").get("main").getAsString();
        String animation=player.getAsJsonObject("animation").get("main").getAsString();
        Map<String,byte[]> selected=new TreeMap<>();selected.put("ysm.json",definition);selected.put(model,require(files,model));selected.put(animation,require(files,animation));
        JsonArray textures=player.getAsJsonArray("texture");if(textures.size()<1 || textures.size()>16)throw new IOException("YSM_TEXTURE_COUNT_BUDGET");
        Map<String,String> texturePaths=new TreeMap<>();
        for(JsonElement element:textures){String texture=element.getAsString();byte[] png=require(files,texture);
            if(png.length<33 || !HexFormat.of().formatHex(Arrays.copyOf(png,8)).equals("89504e470d0a1a0a"))throw new IOException("YSM_PNG_INVALID");
            var dimensions=java.nio.ByteBuffer.wrap(png);int w=dimensions.getInt(16),h=dimensions.getInt(20);
            if(w<1 || h<1 || w>2048 || h>2048 || (long)w*h>2048*2048)throw new IOException("YSM_TEXTURE_DIMENSIONS_BUDGET");
            String name=texture.substring(texture.lastIndexOf('/')+1).replaceFirst("\\.png$","");
            if(texturePaths.put(name,texture)!=null)throw new IOException("YSM_DUPLICATE_TEXTURE_ID");selected.put(texture,png);
        }
        JsonObject bundle=new JsonObject();bundle.addProperty("schemaVersion",1);bundle.addProperty("modelId",id);bundle.addProperty("ysmVersion","2.4.1");
        bundle.addProperty("format","ysm-bedrock-original");bundle.addProperty("sourceSha256",digest(files));bundle.addProperty("model",model);bundle.addProperty("animation",animation);
        bundle.add("textures",JSON.toJsonTree(texturePaths));JsonObject entries=new JsonObject();
        for(var entry:selected.entrySet()){JsonObject data=new JsonObject();data.addProperty("sha256",sha(entry.getValue()));data.addProperty("bytes",entry.getValue().length);data.addProperty("base64",Base64.getEncoder().encodeToString(entry.getValue()));entries.add(entry.getKey(),data);}
        bundle.add("files",entries);byte[] raw=JSON.toJson(bundle).getBytes(java.nio.charset.StandardCharsets.UTF_8);if(raw.length>RAW_LIMIT)throw new IOException("YSM_BUNDLE_BYTE_BUDGET");
        ByteArrayOutputStream out=new ByteArrayOutputStream();try(var gzip=new GZIPOutputStream(out)){gzip.write(raw);}byte[] compressed=out.toByteArray();
        if(compressed.length>ZIP_LIMIT)throw new IOException("YSM_BUNDLE_COMPRESSED_BUDGET");
        return new Asset(id,sha(compressed),compressed,List.copyOf(texturePaths.keySet()),null);
    }
    static String sha(byte[] data) throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));}
    private static String digest(Map<String,byte[]> files) throws Exception {
        MessageDigest hash=MessageDigest.getInstance("SHA-256");for(var entry:new TreeMap<>(files).entrySet()){
            hash.update(entry.getKey().getBytes(java.nio.charset.StandardCharsets.UTF_8));hash.update((byte)0);hash.update(MessageDigest.getInstance("SHA-256").digest(entry.getValue()));
        }return HexFormat.of().formatHex(hash.digest());
    }
}
