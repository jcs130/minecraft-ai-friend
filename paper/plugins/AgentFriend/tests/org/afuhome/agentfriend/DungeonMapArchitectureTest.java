package org.afuhome.agentfriend;

import java.lang.reflect.*;
import java.util.*;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.data.type.Slab;
import sun.misc.Unsafe;

/** Real surface and persisted-definition regressions; no world or actor writes. */
public final class DungeonMapArchitectureTest {
    private static int checks;
    private static void check(boolean value,String name){if(!value)throw new AssertionError(name);checks++;}
    private static Block block(Material material,Slab.Type type){
        Slab slab=(Slab)Proxy.newProxyInstance(DungeonMapArchitectureTest.class.getClassLoader(),new Class<?>[]{Slab.class},(p,m,a)->{
            if(m.getName().equals("getType"))return type;
            throw new UnsupportedOperationException(m.getName());
        });
        return (Block)Proxy.newProxyInstance(DungeonMapArchitectureTest.class.getClassLoader(),new Class<?>[]{Block.class},(p,m,a)->switch(m.getName()){
            case "getType"->material;case "getBlockData"->slab;
            default->throw new UnsupportedOperationException(m.getName());
        });
    }
    public static void main(String[] args)throws Exception{
        check(SiteDungeonManager.flatSpawnSupport(block(Material.SMOOTH_STONE_SLAB,Slab.Type.DOUBLE)),"full double slab is a valid flat surface");
        check(!SiteDungeonManager.flatSpawnSupport(block(Material.SMOOTH_STONE_SLAB,Slab.Type.BOTTOM)),"lower half slab is still rejected");
        check(!SiteDungeonManager.flatSpawnSupport(block(Material.SMOOTH_STONE_SLAB,Slab.Type.TOP)),"upper half slab policy retained");
        check(!SiteDungeonManager.flatSpawnSupport(block(Material.STONE_BRICK_STAIRS,Slab.Type.DOUBLE)),"stairs are not fixed mob spawn positions");
        check(!SiteDungeonManager.flatSpawnSupport(block(Material.OAK_LEAVES,Slab.Type.DOUBLE)),"leaves remain excluded");
        check(!SiteDungeonManager.flatSpawnSupport(block(Material.AIR,Slab.Type.DOUBLE)),"air is never a supported floor");
        check(SiteDungeonManager.flatSpawnSupport(block(Material.SANDSTONE,Slab.Type.DOUBLE)),"original full-block support unchanged");
        var unsafeField=Unsafe.class.getDeclaredField("theUnsafe");unsafeField.setAccessible(true);
        Object manager=((Unsafe)unsafeField.get(null)).allocateInstance(SiteDungeonManager.class);
        var roomClass=Class.forName(SiteDungeonManager.class.getName()+"$Room");
        var roomConstructor=roomClass.getDeclaredConstructor(String.class,int.class,int.class,int.class,int.class,List.class,List.class,String.class);roomConstructor.setAccessible(true);
        var siteClass=Class.forName(SiteDungeonManager.class.getName()+"$Site");
        var siteConstructor=siteClass.getDeclaredConstructors()[0];siteConstructor.setAccessible(true);
        var definition=SiteDungeonManager.class.getDeclaredMethod("definition",siteClass);definition.setAccessible(true);
        String[] values=new String[2];int index=0;
        for(String hint:List.of("","沿原石梯到上层，不挖建筑")){
            Object room=roomConstructor.newInstance("Legacy",0,81,0,4,List.of(),List.of(),hint);
            Object site=siteConstructor.newInstance("qa","QA","undead_crypt","",Material.STONE,"world",List.of(room),8,Material.IRON_INGOT,4,List.of(),false,0,1);
            values[index++]=(String)definition.invoke(manager,site);
        }
        String old="{\"id\":\"qa\",\"name\":\"QA\",\"expedition\":\"undead_crypt\",\"hint\":\"\",\"icon\":\"STONE\",\"world\":\"world\",\"rooms\":[{\"name\":\"Legacy\",\"x\":0,\"y\":81,\"z\":0,\"radius\":4,\"enemies\":[]}],\"emeralds\":8,\"bonus\":\"IRON_INGOT\",\"bonusCount\":4,\"entry\":[],\"conquestFloor\":0,\"minimumLevel\":1}";
        check(values[0].equals(old),"legacy checkpoints retain exact serialized definition");
        check(values[1].equals(old),"presentation-only route hints never invalidate an old checkpoint");
        System.out.println("Dungeon architecture: "+checks+" checks passed");
    }
}
