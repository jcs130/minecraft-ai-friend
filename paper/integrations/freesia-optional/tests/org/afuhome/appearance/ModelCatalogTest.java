package org.afuhome.appearance;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;
import java.io.*;
/** Uses the pinned CC0 native source directory, never copies assets into Git. */
public final class ModelCatalogTest {
    static int checks;
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);checks++;System.out.println("PASS "+message);}
    public static void main(String[] args) throws Exception {
        Path source=Path.of(args[0]),root=Path.of(args[1]);Files.createDirectory(root);Path custom=root.resolve("custom");Files.createDirectory(custom);
        Path model=custom.resolve("uploaded_fixture");Map<String,byte[]> originals=new TreeMap<>();
        try(var paths=Files.walk(source)){for(Path p:paths.toList())if(Files.isRegularFile(p)){String rel=source.relativize(p).toString().replace('\\','/');originals.put(rel,Files.readAllBytes(p));Path dest=model.resolve(rel);Files.createDirectories(dest.getParent());Files.write(dest,originals.get(rel));}}
        Path config=root.resolve("models.json");Files.writeString(config,"{\"publicModelRoot\":\""+custom.toString().replace('\\','/')+"\"}");ModelCatalog catalog=new ModelCatalog(config);
        catalog.scan();check(catalog.get("uploaded_fixture")==null,"wait for two stable upload scans");catalog.scan();var first=catalog.get("uploaded_fixture");
        check(first.available()&&first.textures().contains("blue"),"new folder auto-converts original geometry/animation/textures");
        Files.write(model.resolve("textures/blue.png"),originals.get("textures/red.png"));catalog.scan();check(catalog.get("uploaded_fixture").sha256().equals(first.sha256()),"partial upload retains preceding validated revision");
        catalog.scan();check(!catalog.get("uploaded_fixture").sha256().equals(first.sha256()),"stable texture replacement invalidates original bundle hash");
        try(var zip=new ZipOutputStream(Files.newOutputStream(custom.resolve("uploaded_zip.zip")))){for(var entry:originals.entrySet()){zip.putNextEntry(new ZipEntry("nested/"+entry.getKey()));zip.write(entry.getValue());zip.closeEntry();}}
        catalog.scan();catalog.scan();check(catalog.get("uploaded_zip").available(),"wrapped user ZIP auto-converts without extraction");
        Files.writeString(custom.resolve("encrypted.ysm"),"encrypted source fixture");catalog.scan();check("YSM_ENCRYPTED_SOURCE_REQUIRED".equals(catalog.get("encrypted").reason()),"encrypted models report original-source requirement");
        try(var zip=new ZipOutputStream(Files.newOutputStream(custom.resolve("traversal.zip")))){zip.putNextEntry(new ZipEntry("../secret"));zip.write(1);zip.closeEntry();}
        catalog.scan();check("YSM_FILE_PATH_INVALID".equals(catalog.get("traversal").reason())&&!Files.exists(root.resolve("secret")),"ZIP traversal rejected with zero extracted files");
        Files.delete(custom.resolve("uploaded_zip.zip"));catalog.scan();check(catalog.get("uploaded_zip")==null,"removed model immediately disappears from public catalog");
        var copy=new TreeMap<>(originals);copy.put("ysm.json",new String(copy.get("ysm.json"),java.nio.charset.StandardCharsets.UTF_8).replace("\"free\": true","\"free\": false").getBytes(java.nio.charset.StandardCharsets.UTF_8));
        try{ModelCatalog.convert("private",copy);throw new AssertionError("private export accepted");}catch(IOException e){check(e.getMessage().equals("YSM_PUBLIC_SHARE_PERMISSION_REQUIRED"),"restricted/auth-only source is never exported");}
        catalog.invalidate();check(catalog.catalog().isEmpty(),"invalid local configuration revokes public assets");System.out.println("Checks: "+checks);
    }
}
