package org.afuhome.appearance;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;
import java.io.*;

/** Standalone source/bundle test; fixture input and exports stay outside Git. */
public final class ModelCatalogTest {
    public static void main(String[] args) throws Exception {
        Path input=Path.of(args[0]),output=Path.of(args[1]);Files.createDirectories(output);
        int checked=0;
        for(String name:List.of("cormy","neko_yui")) {
            Path root=input.resolve(name);Map<String,byte[]> source=new TreeMap<>();
            try(var walk=Files.walk(root)){for(Path p:walk.filter(Files::isRegularFile).toList())source.put(root.relativize(p).toString().replace('\\','/'),Files.readAllBytes(p));}
            var asset=ModelCatalog.convert(name,source);if(!asset.available())throw new AssertionError(asset.reason());
            byte[] raw;try(var gzip=new GZIPInputStream(new ByteArrayInputStream(asset.gzip()))){raw=gzip.readAllBytes();}
            JsonObject bundle=JsonParser.parseString(new String(raw,java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
            JsonObject animations=bundle.getAsJsonObject("animations"),files=bundle.getAsJsonObject("files");
            for(String kind:List.of("main","arm","extra")) {
                String path=animations.get(kind).getAsString();byte[] actual=Base64.getDecoder().decode(files.getAsJsonObject(path).get("base64").getAsString());
                if(!Arrays.equals(actual,source.get(path)))throw new AssertionError("Original animation changed: "+kind);checked++;
            }
            bundle.addProperty("assetSha256",asset.sha256());Files.writeString(output.resolve(name+".json"),bundle.toString());
            Files.write(output.resolve(name+".gz"),asset.gzip());
            // Broken referenced equipment animation must fail conversion, never
            // quietly publish an apparently complete static-only model.
            Map<String,byte[]> broken=new TreeMap<>(source);broken.remove(animations.get("arm").getAsString());
            try{ModelCatalog.convert(name,broken);throw new AssertionError("Missing arm file accepted");}catch(IOException expected){if(!expected.getMessage().equals("YSM_REFERENCED_FILE_MISSING"))throw expected;checked++;}
            System.out.println(name+" sha256="+asset.sha256()+" compressed="+asset.gzip().length+" files="+files.size());
        }
        System.out.println("PASS original animation bundle checks="+checked);
    }
}
