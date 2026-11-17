import java.nio.file.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;
public class QaPaperAttributes {
  public static void main(String[] a) throws Exception {
    var p=Path.of(a[0]);var c=new ClassNode();new ClassReader(Files.readAllBytes(p)).accept(c,0);
    int count=0;
    for(var m:c.methods)for(var i:m.instructions)if(i instanceof FieldInsnNode f && f.owner.equals("org/bukkit/attribute/Attribute") && !f.name.startsWith("GENERIC_")) {
      f.name="GENERIC_"+f.name;count++;
    }
    if(count!=5)throw new IllegalStateException("reviewed compatibility sites="+count);
    var w=new ClassWriter(0);c.accept(w);Files.write(p,w.toByteArray());
  }
}
