import java.lang.reflect.*;
import java.util.*;
import org.bukkit.inventory.meta.ItemMeta;
public final class ItemModel1211Test {
    public static void main(String[] args)throws Exception{
        var calls=new ArrayList<Integer>();ItemMeta meta=(ItemMeta)Proxy.newProxyInstance(ItemMeta.class.getClassLoader(),new Class[]{ItemMeta.class},(p,m,a)->{if(m.getName().equals("setCustomModelData")){calls.add((Integer)a[0]);return null;}throw new AssertionError("Unexpected newer API "+m);});
        var method=Class.forName("io.vortexcore.item.CustomItemService").getDeclaredMethod("applyCustomModelData",ItemMeta.class,Integer.class);method.setAccessible(true);
        method.invoke(null,null,10);if(!calls.isEmpty())throw new AssertionError("null meta");
        method.invoke(null,meta,null);if(!calls.isEmpty())throw new AssertionError("null value");
        method.invoke(null,meta,37);if(!calls.equals(List.of(37)))throw new AssertionError("exact model number");
        method.invoke(null,meta,10004);if(!calls.equals(List.of(37,10004)))throw new AssertionError("no duplicate or newer API writes");
        System.out.println("item model 1.21.1=4");
    }
}
