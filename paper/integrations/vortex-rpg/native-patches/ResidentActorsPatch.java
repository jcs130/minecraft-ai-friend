import java.nio.file.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;

/** Preserve native formulas, gates and cooldowns; only resolve registered non-player bodies. */
public final class ResidentActorsPatch implements Opcodes {
    public static void main(String[] args)throws Exception{
        Path root=Path.of(args[0]);int mana=0,damage=0,lookups=0,filters=0;
        try(var files=Files.walk(root.resolve("io/vortexcore"))){for(var path:files.filter(p->p.toString().endsWith(".class")).toList()){
            String relative=root.relativize(path).toString().replace('\\','/');
            if(!relative.startsWith("io/vortexcore/rpg/SpellbookService")&&!relative.equals("io/vortexcore/combat/ManaManager.class"))continue;
            var type=new ClassNode();new ClassReader(Files.readAllBytes(path)).accept(type,0);boolean changed=false;
            for(var method:type.methods)for(var ins:method.instructions.toArray())if(ins instanceof MethodInsnNode call){
                if(call.owner.equals("org/bukkit/Bukkit")&&call.name.equals("getEntity")&&call.desc.equals("(Ljava/util/UUID;)Lorg/bukkit/entity/Entity;")
                    &&(method.name.equals("matchesTargetScope")||relative.endsWith("$TargetEntityKindCondition.class")&&method.name.equals("test"))){
                    call.owner="io/vortexcore/rpg/ResidentActors";call.name="classificationEntity";changed=true;filters++;
                }
                if(call.owner.equals("org/bukkit/Bukkit")&&(call.name.equals("getPlayer")&&call.desc.equals("(Ljava/util/UUID;)Lorg/bukkit/entity/Player;")
                    ||call.name.equals("getOnlinePlayers")&&call.desc.equals("()Ljava/util/Collection;"))){
                    call.owner="io/vortexcore/rpg/ResidentActors";call.name=call.name.equals("getPlayer")?"player":"online";changed=true;lookups++;if(relative.endsWith("/ManaManager.class"))mana++;
                }
                if(call.name.equals("damage")&&call.desc.equals("(DLorg/bukkit/entity/Entity;)V")){
                    method.instructions.insertBefore(call,new MethodInsnNode(INVOKESTATIC,"io/vortexcore/rpg/ResidentActors","source","(Lorg/bukkit/entity/Entity;)Lorg/bukkit/entity/Entity;",false));changed=true;damage++;
                }
            }
            if(changed){var writer=new ClassWriter(ClassWriter.COMPUTE_MAXS);type.accept(writer);Files.write(path,writer.toByteArray());}
        }}
        if(mana!=3||damage!=1||filters!=3)throw new IllegalStateException("unexpected native actor call sites mana="+mana+", damage="+damage+", filters="+filters);
        System.out.println("Native actor lookup sites="+lookups+", damage source sites="+damage+", classification sites="+filters);
    }
}
