package org.afuhome.appearance;
import com.google.gson.*;

/** Standalone tests against the actual production Freesia / PacketEvents API. */
public final class NativeCompanionsTest {
    private static final long NOW=1792493000000L;
    private static JsonObject snapshot() {
        return JsonParser.parseString("""
            {"schemaVersion":1,"source":"numen_server","epoch":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
             "observedAt":1792493000000,"players":[{"playerUuid":"8e7b99e0-595d-3402-935c-7139ac6814e3",
             "playerName":"ag_Kirito","entityId":121,"dimension":"minecraft:overworld","backend":"paper",
             "modelId":"qiandengji_kirito","texture":"skin"}]}
            """).getAsJsonObject();
    }
    private static void check(boolean value,String label) { if(!value)throw new AssertionError(label); }
    public static void main(String[] args) {
        var root=snapshot();check(NativeCompanions.parse(root,NOW).size()==1,"valid original UUID");
        check(NativeCompanions.parse(root,NOW+15001).isEmpty(),"stale projection expires");
        check(NativeCompanions.parse(root,NOW-5001).isEmpty(),"future timestamp refused");
        root=snapshot();root.addProperty("source","client");check(NativeCompanions.parse(root,NOW).isEmpty(),"client source refused");
        root=snapshot();root.getAsJsonArray("players").get(0).getAsJsonObject().addProperty("entityId",-1);
        check(NativeCompanions.parse(root,NOW).isEmpty(),"invalid entity refused");
        root=snapshot();root.getAsJsonArray("players").get(0).getAsJsonObject().addProperty("modelId","../private");
        check(NativeCompanions.parse(root,NOW).isEmpty(),"invalid model path refused");
        root=snapshot();root.getAsJsonArray("players").add(root.getAsJsonArray("players").get(0).deepCopy());
        check(NativeCompanions.parse(root,NOW).isEmpty(),"duplicate UUID refused as whole batch");
        root=snapshot();root.getAsJsonArray("players").get(0).getAsJsonObject().addProperty("entityId",122);
        check(NativeCompanions.parse(root,NOW).values().iterator().next().entityId()==122,"actual respawn ID wins");
        System.out.println("PASS 8 native companion identity and expiry checks");
    }
}
