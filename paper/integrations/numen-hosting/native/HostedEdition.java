import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.jar.*;
import org.objectweb.asm.*;
import org.objectweb.asm.commons.*;

/** Package the upstream implementation as an independent hosting edition;
 * classic Numen bytecode, commands, channels and persistence stay separate. */
public final class HostedEdition {
  static String text(String s) {
    return s.replace("com.dwinovo.numen.","com.dwinovo.numen.hosted.")
      .replace("numen_api","numen_hosted_api").replace("name: numen\n","name: numen_hosted\n")
      .replace("META-INF/numen/","META-INF/numen_hosted/").replace("assets/numen/","assets/numen_hosted/").replace("data/numen/","data/numen_hosted/")
      .replace("numen:","numen_hosted:").replaceAll("(?<![A-Za-z0-9_./-])numen\\.","numen_hosted.");
  }
  static String constant(String s) {
    if(s.startsWith("com.dwinovo.numen.hosted."))return s;
    if(s.startsWith("numen_")&&!s.startsWith("numen_hosted_"))return "numen_hosted_"+s.substring(6);
    if(s.equals("numen"))return "numen_hosted";
    if(s.startsWith("numen."))return "numen_hosted."+s.substring(6);
    if(s.startsWith("numen "))return "numen_hosted "+s.substring(6);
    if(s.startsWith("/numen "))return "/numen_hosted "+s.substring(7);
    return text(s);
  }
  public static void main(String[] args) throws Exception {
    if(args.length!=4 || !args[2].matches("[0-9]+(?:\\.[0-9]+){2}") || !args[3].matches("[1-9][0-9]*"))
      throw new IllegalArgumentException("expected input, output, upstream version and hosting edition");
    String[] currentClass={""};
    Remapper remapper=new Remapper(Opcodes.ASM9) {
      @Override public String map(String name) {
        if(name.startsWith("com/dwinovo/numen/hosted/"))return name;
        return name.startsWith("com/dwinovo/numen/")?"com/dwinovo/numen/hosted/"+name.substring("com/dwinovo/numen/".length()):name;
      }
      @Override public Object mapValue(Object value) {
        if(value instanceof String s){
          if(s.equals("numen")&&currentClass[0].endsWith("/mcp/server/HostedBodyEndpoint"))return s;
          return constant(s);
        }
        return super.mapValue(value);
      }
    };
    Map<String,byte[]> written=new HashMap<>();int classes=0;
    try(var input=new JarFile(args[0]);var output=new JarOutputStream(Files.newOutputStream(Path.of(args[1]),StandardOpenOption.CREATE_NEW))) {
      for(var entries=input.entries();entries.hasMoreElements();) {
        var entry=entries.nextElement();if(entry.isDirectory())continue;
        String name=entry.getName();byte[] bytes=input.getInputStream(entry).readAllBytes();
        if(name.endsWith(".class")) {
          var reader=new ClassReader(bytes);
          currentClass[0]=reader.getClassName();
          if(reader.getClassName().startsWith("com/dwinovo/numen/")){
            var writer=new ClassWriter(0);reader.accept(new ClassRemapper(writer,remapper),0);bytes=writer.toByteArray();name=remapper.map(reader.getClassName())+".class";classes++;
          }
        } else {
          name=text(name);
          name=String.join("/",Arrays.stream(name.split("/")).map(part->part.equals("numen")?"numen_hosted":part).toList());
          if(name.endsWith(".yml")||name.endsWith(".yaml")||name.endsWith(".json")||name.endsWith(".md")||name.endsWith(".lua")||name.startsWith("META-INF/services/"))
            bytes=text(new String(bytes,StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8);
          if(name.equals("paper-plugin.yml")) {
            String descriptor=new String(bytes,StandardCharsets.UTF_8);
            String upstreamVersion="version: '"+args[2]+"'";
            if(!descriptor.lines().anyMatch(upstreamVersion::equals))throw new IllegalArgumentException("unexpected Numen plugin version");
            bytes=descriptor.replace(upstreamVersion,"version: '"+args[2]+"-hosted."+args[3]+"'").getBytes(StandardCharsets.UTF_8);
          }
        }
        byte[] previous=written.putIfAbsent(name,bytes);
        if(previous!=null){if(Arrays.equals(previous,bytes))continue;throw new IllegalStateException("different duplicate output resource: "+name);}
        var target=new JarEntry(name);target.setTime(0);output.putNextEntry(target);output.write(bytes);output.closeEntry();
      }
    }
    System.out.println("Packaged "+classes+" classes into "+Path.of(args[1]).getFileName());
  }
}
