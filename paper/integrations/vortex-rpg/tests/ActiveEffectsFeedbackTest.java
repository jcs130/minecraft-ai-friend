package org.qiandengji.vortex;

import java.lang.reflect.Method;
import java.util.*;
import org.bukkit.entity.Player;
import static org.mockito.Mockito.*;

/** Actual status projection, read-only effects; Bukkit API doubles, no game. */
public final class ActiveEffectsFeedbackTest {
    static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
    public static void main(String[] args)throws Exception {
        var player=mock(Player.class);
        Method rows=VortexBridge.class.getDeclaredMethod("activeEffects",Player.class),text=VortexBridge.class.getDeclaredMethod("activeEffectsText",Player.class);
        rows.setAccessible(true);text.setAccessible(true);
        when(player.getActivePotionEffects()).thenReturn(List.of());
        check(((List<?>)rows.invoke(null,player)).isEmpty(),"empty effects");
        check(text.invoke(null,player).equals(""),"empty text");
        Method row=VortexBridge.class.getDeclaredMethod("activeEffect",String.class,int.class,int.class);
        Method format=VortexBridge.class.getDeclaredMethod("activeEffectsText",List.class);
        row.setAccessible(true);format.setAccessible(true);
        // Feed original API scalar values into the actual projection; no live
        // Paper registry is initialized or replaced by this offline fixture.
        var result=List.of(row.invoke(null,"resistance",0,160),row.invoke(null,"night_vision",0,-1),row.invoke(null,"speed",1,39));
        var infinite=(Map<?,?>)result.get(1);
        check(Boolean.TRUE.equals(infinite.get("infinite")),"permanent effects must be explicit");
        check(((Number)infinite.get("durationTicks")).intValue()==-1,"preserve original ticks");
        var old=Locale.getDefault();
        try{
            Locale.setDefault(Locale.GERMANY);
            String rendered=(String)format.invoke(null,result);
            check(rendered.contains("抗性提升 1级 8.0秒"),"localized level and actual duration");
            check(rendered.contains("夜视 1级 持续生效"),"no negative seconds");
            check(rendered.contains("速度 2级 2.0秒"),"stable decimal locale");
            check(!rendered.contains("-0.1")&&!rendered.contains("8,0"),"no misleading duration");
        }finally{Locale.setDefault(old);}
        verify(player,never()).addPotionEffect(any());verify(player,never()).removePotionEffect(any());
        System.out.println("active-effects: empty/timed/infinite/levels/localization/locale/read-only passed=true");
    }
}
