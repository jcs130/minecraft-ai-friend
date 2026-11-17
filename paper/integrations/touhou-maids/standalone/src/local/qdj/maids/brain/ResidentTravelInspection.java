package local.qdj.maids.brain;

import com.google.gson.JsonObject;
import java.util.Set;

/** An operator must name the live observed body position; a missing or stale observation is not consent. */
final class ResidentTravelInspection {
    static void check(JsonObject evidence,String dimension,double x,double y,double z){
        if(evidence==null||!evidence.keySet().equals(Set.of("dimension","x","y","z","note")))
            throw new IllegalArgumentException("inspection: dimension,x,y,z,note required");
        if(!evidence.get("dimension").isJsonPrimitive()||!evidence.get("dimension").getAsJsonPrimitive().isString()
            ||!dimension.equals(evidence.get("dimension").getAsString()))throw new IllegalArgumentException("inspection_dimension_changed");
        if(!evidence.get("note").isJsonPrimitive()||!evidence.get("note").getAsJsonPrimitive().isString()
            ||!ResidentConfigText.valid(evidence.get("note").getAsString()))throw new IllegalArgumentException("inspection_note_required");
        double distance=0;double[] actual={x,y,z};int index=0;
        for(String key:new String[]{"x","y","z"}){
            var value=evidence.get(key);if(!value.isJsonPrimitive()||!value.getAsJsonPrimitive().isNumber())throw new IllegalArgumentException("inspection."+key+": finite number required");
            double n=value.getAsDouble();if(!Double.isFinite(n))throw new IllegalArgumentException("inspection."+key+": finite number required");
            distance+=Math.pow(n-actual[index++],2);
        }
        if(distance>.25)throw new IllegalArgumentException("inspection_position_changed_read_again");
    }
    private static final class ResidentConfigText {
        static boolean valid(String s){return s.strip().length()>=8&&s.length()<=300&&!s.codePoints().anyMatch(Character::isISOControl);}
    }
}
