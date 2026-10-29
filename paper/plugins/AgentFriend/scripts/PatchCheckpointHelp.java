import java.nio.file.*;
import java.util.*;
import jdk.internal.org.objectweb.asm.*;
/** Only replace reviewed constant strings in the pinned CLI implementation. */
public final class PatchCheckpointHelp {
    public static void main(String[] args)throws Exception {
        var changes=Map.of(
            "查空闲可开、占用、故障、当前房间或待领奖","查当前房间、存档点、剩余机会、占用或待领奖",
            "在首室发起挑战；原生队伍全员到场后由队长一次登记全队","首室由队长登记全队；战败回存档点，第三次战败结束，Boss房间排他",
            "默认只给当前一步；--json含真实状态和凭据；完整旧结果用--verbose","默认当前一步及剩余机会；--json含真实状态和凭据；完整旧结果用--verbose",
            "MC_SITE_DUNGEON_RESULT；逐室清怪、返回首室才登记奖励；无自动免费位移","MC_SITE_DUNGEON_RESULT；战败自动回存档点，整场第三次战败结束；Boss房间仅本场队伍进入，清完后返回首室领奖",
            "需先学travel：skills info travel / skills learn travel；成功远程开页2魔力，实体箱旁免费，无需先传送","基础远程存箱已可用；成功远程开页2魔力，实体箱旁免费，无需学习或先传送",
            "打开本人第一页54格双箱；10页共540格；支持原版箱子操作","本人540格个人箱；Agent可直接putslot存、list查、take取，无需开界面",
            "每页54格；先学travel，成功远程开页2魔力","每页54格；无需学习，成功远程开页2魔力",
            "按精确背包槽存入；保留附魔与自定义物品","按背包0–35槽直接远程存入；非绑定装备保留附魔和外观",
            "MC_STASH_PUT moved 数量与远程 MC_STORAGE_MAGIC","MC_STASH_PUT moved>0才完成；不先开界面、不传送，空槽或箱满不移动物品");
        var reader=new ClassReader(Files.readAllBytes(Path.of(args[0])));var writer=new ClassWriter(reader,0);var seen=new HashMap<String,Integer>();
        reader.accept(new ClassVisitor(Opcodes.ASM8,writer){
            @Override public MethodVisitor visitMethod(int a,String n,String d,String s,String[] e){return new MethodVisitor(Opcodes.ASM8,super.visitMethod(a,n,d,s,e)){
                @Override public void visitLdcInsn(Object value){if(value instanceof String text&&changes.containsKey(text)){seen.merge(text,1,Integer::sum);value=changes.get(text);}super.visitLdcInsn(value);}
            };}
        },0);
        for(String key:changes.keySet())if(seen.getOrDefault(key,0)!=(key.startsWith("需先学travel")||key.startsWith("MC_STASH_PUT moved ")?2:1))throw new IllegalStateException("Pinned CLI help did not match: "+key);
        Files.write(Path.of(args[1]),writer.toByteArray());
    }
}
