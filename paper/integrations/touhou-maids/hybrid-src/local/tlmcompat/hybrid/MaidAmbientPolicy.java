package local.tlmcompat.hybrid;

import java.util.HashMap;
import java.util.Map;

/** Only reacts to real native sound events; no timer invents game events. */
final class MaidAmbientPolicy {
    static final long GLOBAL_GAP=90_000_000_000L;
    private final Map<String,Long> last=new HashMap<>();
    private final Map<String,Integer> variants=new HashMap<>();
    private long nextAny=Long.MIN_VALUE;
    String choose(String sound,long now,boolean audience){
        if(!audience||now<nextAny||"touhou_little_maid:maid.mode.idle".equals(sound)||MaidSpeechLines.forSound(sound)==null)return null;
        long gap=sound.startsWith("touhou_little_maid:maid.environment.")?600_000_000_000L:180_000_000_000L;
        Long previous=last.get(sound);if(previous!=null&&now-previous<gap)return null;
        int variant=variants.getOrDefault(sound,0);String text=MaidSpeechLines.forSound(sound,variant);
        last.put(sound,now);variants.put(sound,(variant+1)%6);nextAny=now+GLOBAL_GAP;return text;
    }
    /** Match current facts as well as the native event; changing a job is not combat. */
    static boolean matchesScene(String sound,String task,boolean fighting,boolean hurt,boolean unavailable,long time,boolean raining,boolean exposed){
        if(sound==null||task==null||unavailable||!sound.startsWith("touhou_little_maid:maid."))return false;
        String event=sound.substring("touhou_little_maid:maid.".length());
        if(event.equals("mode.idle"))return false;
        if(event.startsWith("mode.")){
            String mode=event.substring(5);
            return task.equals("touhou_little_maid:"+mode)&&(!mode.contains("attack")||fighting);
        }
        return switch(event){
            case "ai.find_target" -> fighting;
            case "ai.hurt","ai.hurt_fire","ai.hurt_player" -> hurt;
            case "ai.item_get","ai.tamed","ai.game_win","ai.game_lost" -> true;
            case "environment.morning" -> !fighting&&time>=0&&time<2000;
            case "environment.night" -> !fighting&&time>=13000&&time<23000;
            case "environment.rain","environment.snow" -> !fighting&&raining&&exposed;
            default -> false;
        };
    }
}
