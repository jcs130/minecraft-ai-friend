package io.vortexcore.rpg;

import java.util.*;
import org.bukkit.Bukkit;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;

/** Explicit native residents only. Extends RPG lookup, never Bukkit's online roster or authentication. */
public final class ResidentActors {
    private static final Map<UUID,Player> actors=new LinkedHashMap<>();
    private ResidentActors(){}
    public static void register(Player p){
        var af=Bukkit.getPluginManager().getPlugin("AgentFriend");
        try{var api=af.getClass().getClassLoader().loadClass("org.afuhome.agentfriend.ResidentCli");
            if(!Boolean.TRUE.equals(api.getMethod("isResident",UUID.class).invoke(null,p.getUniqueId()))||Bukkit.getPlayer(p.getUniqueId())!=null)
                throw new IllegalArgumentException("native_resident_identity_required");
            actors.put(p.getUniqueId(),p);
        }catch(ReflectiveOperationException e){throw new IllegalStateException("resident_identity_unavailable",e);}
    }
    public static Player player(UUID id){var online=Bukkit.getPlayer(id);return online!=null?online:actors.get(id);}
    /** Classification only: team spell filters treat a registered resident like a player, not a monster. */
    public static Entity classificationEntity(UUID id){var actual=Bukkit.getEntity(id);return actual!=null&&actors.containsKey(id)?actors.get(id):actual;}
    public static Collection<Player> online(){var out=new ArrayList<Player>(Bukkit.getOnlinePlayers());
        for(var p:actors.values())try{if(p.isOnline()&&Bukkit.getPlayer(p.getUniqueId())==null)out.add(p);}catch(RuntimeException unloaded){}
        return out;
    }
    public static Entity source(Entity e){
        if(e==null||!actors.containsKey(e.getUniqueId()))return e;
        var actual=Bukkit.getEntity(e.getUniqueId());if(actual==null)throw new IllegalStateException("native_caster_body_unavailable");return actual;
    }
    public static boolean registered(UUID id){return actors.containsKey(id);}
}
