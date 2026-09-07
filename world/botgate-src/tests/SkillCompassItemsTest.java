import dev.god.botgate.chest.SkillChestLayout;
import net.minecraft.SharedConstants;
import net.minecraft.core.component.DataComponents;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import java.lang.reflect.Method;
import java.util.List;

/** Exercise actual MC item components, names and lore without loading any world. */
public class SkillCompassItemsTest {
    static int assertions;
    static void check(boolean value,String message) { assertions++; if(!value)throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        SharedConstants.tryDetectVersion(); Bootstrap.bootStrap();
        Method icon=Class.forName("dev.god.botgate.chest.SkillChestMenu").getDeclaredMethod("iconStack",SkillChestLayout.Entry.class);
        icon.setAccessible(true);
        var cfg=new SkillChestLayout.Config();cfg.catalogAvailable=true;
        cfg.skillNames.put("home","归途");cfg.skillIcons.put("home","minecraft:compass");cfg.skillLore.put("home","消耗：20 秘术魔力\n需要等级：2");
        var entries=SkillChestLayout.build(cfg,List.of(new SkillChestLayout.SkillInfo("home")),List.of(),0);
        for(var e:entries) { var item=(ItemStack)icon.invoke(null,e); check(!item.isEmpty(),"every grid cell has a drawable stack"); }
        var nativeItem=(ItemStack)icon.invoke(null,entries.get(0));
        check(nativeItem.is(Items.ENCHANTED_BOOK),"recognizable native spell book icon");
        check(nativeItem.get(DataComponents.CUSTOM_NAME).getString().contains("铁魔法"),"native name survives real component");
        check(nativeItem.get(DataComponents.CUSTOM_NAME).getStyle().getColor()!=null,"explicit colored name");
        var skill=(ItemStack)icon.invoke(null,entries.get(9));
        check(skill.is(Items.COMPASS),"configured semantic icon");
        var lines=skill.get(DataComponents.LORE).lines();
        check(lines.size()>=4 && lines.stream().anyMatch(line->line.getString().contains("20 秘术魔力")),"split lore lines preserve resource help");
        check(lines.stream().anyMatch(line->line.getString().contains("A / 左键")),"controller and mouse confirmation help");
        var archive=SkillChestLayout.buildArchive(cfg,List.of(new SkillChestLayout.SkillInfo("home")),0);
        var archived=(ItemStack)icon.invoke(null,archive.get(9));
        check(archived.get(DataComponents.LORE).lines().stream().anyMatch(line->line.getString().contains("只读档案")),"archive readable but not cast instruction");
        cfg.skillIcons.put("home","unknown:missing_icon");
        var missing=SkillChestLayout.build(cfg,List.of(new SkillChestLayout.SkillInfo("home")),List.of(),0);
        var fallback=(ItemStack)icon.invoke(null,missing.get(9));
        check(fallback.is(Items.GRAY_STAINED_GLASS_PANE) && fallback.get(DataComponents.CUSTOM_NAME).getString().equals("归途"),"unknown registry icon visible fallback retains skill label");
        System.out.println("SkillCompassItemsTest: "+assertions+" assertions passed");
    }
}
