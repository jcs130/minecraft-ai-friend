package local.tlmcompat.hybrid;

import java.util.HashMap;
import java.util.Map;

/** Only reacts to real native sound events; no timer invents game events. */
final class MaidAmbientPolicy {
    private final Map<String,Long> last=new HashMap<>();
    private final Map<String,Integer> variants=new HashMap<>();
    private long nextAny=Long.MIN_VALUE;
    String choose(String sound,long now,boolean audience){
        if(!audience||now<nextAny||MaidSpeechLines.forSound(sound)==null)return null;
        long gap="touhou_little_maid:maid.mode.idle".equals(sound)?180_000_000_000L:45_000_000_000L;
        Long previous=last.get(sound);if(previous!=null&&now-previous<gap)return null;
        int variant=variants.getOrDefault(sound,0);String text=MaidSpeechLines.forSound(sound,variant);
        last.put(sound,now);variants.put(sound,(variant+1)%6);nextAny=now+20_000_000_000L;return text;
    }
}
