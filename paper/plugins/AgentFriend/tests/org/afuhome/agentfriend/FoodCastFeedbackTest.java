package org.afuhome.agentfriend;

import com.nisovin.magicspells.Spell;
import com.nisovin.magicspells.events.SpellCastEvent;
import java.lang.reflect.Field;
import org.bukkit.GameMode;
import org.bukkit.entity.Player;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Real pre-cast handler with explicit Bukkit/MagicSpells doubles; no real player. */
public final class FoodCastFeedbackTest {
    public static void main(String[] args)throws Exception {
        var plugin=mock(AgentFriendPlugin.class);
        doCallRealMethod().when(plugin).onSpellPreCast(any());
        var professions=mock(ProfessionManager.class);
        when(professions.basicAllowed(any(),anyString())).thenReturn(true);
        Field field=AgentFriendPlugin.class.getDeclaredField("professions");field.setAccessible(true);field.set(plugin,professions);
        var player=mock(Player.class);when(player.getGameMode()).thenReturn(GameMode.SURVIVAL);
        var spell=mock(Spell.class);when(spell.getInternalName()).thenReturn("food");
        when(plugin.hasMana(any(),anyDouble())).thenReturn(true);
        for(int food:new int[]{20,19,0}) {
            var event=mock(SpellCastEvent.class);when(event.getCaster()).thenReturn(player);when(event.getSpell()).thenReturn(spell);
            when(event.getSpellCastState()).thenReturn(Spell.SpellCastState.NORMAL);when(player.getFoodLevel()).thenReturn(food);
            clearInvocations(plugin,player);
            plugin.onSpellPreCast(event);
            if(food==20){
                verify(event).setCancelled(true);
                verify(player).sendMessage(contains("未耗魔"));
                verify(plugin,never()).hasMana(any(),anyDouble());
            }else{
                verify(event,never()).setCancelled(true);
                verify(plugin).hasMana(eq(player),anyDouble());
            }
            verify(plugin,never()).spendMana(any(),anyDouble());
        }
        System.out.println("food-precast: full rejected before mana; hungry admitted; no pre-cast debit; passed=true");
    }
}
