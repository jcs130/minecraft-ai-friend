package dev.god.godvoice;

import java.util.*;

/** Immutable main-thread observations; audio/ASR threads never read Bukkit entities. */
final class VoiceAudience {
    record Actor(UUID id, UUID session, UUID world, double x, double y, double z, String name, boolean captions) { }
    record Snapshot(long at, Map<UUID,Actor> actors) {
        Snapshot { actors=Map.copyOf(actors); }
    }
    static final class Window {
        private Map<UUID,Actor> listeners;
        private UUID world;
        void observe(Snapshot snapshot, UUID speaker, double distance, long now) {
            Map<UUID,Actor> heard = new HashMap<>();
            Actor source=snapshot.actors.get(speaker);
            if (source!=null && now-snapshot.at>=0 && now-snapshot.at<=200 && Double.isFinite(distance) && distance>0) {
                if(world!=null&&!world.equals(source.world)){listeners=Map.of();return;}
                world=source.world;
                for(Actor actor:snapshot.actors.values()) {
                    if(actor.id.equals(speaker)||!actor.captions||!actor.world.equals(source.world))continue;
                    double x=actor.x-source.x,y=actor.y-source.y,z=actor.z-source.z;
                    if(x*x+y*y+z*z<=distance*distance)heard.put(actor.id,actor);
                }
            }
            if(listeners==null)listeners=heard;
            else listeners.entrySet().removeIf(entry->{Actor current=heard.get(entry.getKey());return current==null||!current.session.equals(entry.getValue().session);});
        }
        Map<UUID,Actor> finish(){return listeners==null?Map.of():Map.copyOf(listeners);}
        UUID world(){return world;}
    }
    static Set<UUID> deliverable(Map<UUID,Actor> original, UUID world, Snapshot current) {
        Set<UUID> result=new HashSet<>();
        for(Actor heard:original.values()) {
            Actor live=current.actors.get(heard.id);
            if(live!=null&&live.captions&&live.session.equals(heard.session)&&live.world.equals(world))result.add(live.id);
        }
        return Set.copyOf(result);
    }
}
