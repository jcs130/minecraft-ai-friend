package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;

/** Runs with the server's Gson and the production pure helper; no Bukkit or game writes. */
public final class PrivateChatIdentityTest {
    static int checks;
    static void check(boolean value) { if (!value) throw new AssertionError("check " + checks); checks++; }
    static JsonObject component(UUID id) {
        JsonObject value = JsonParser.parseString("{\"text\":\"◆黑铁 [Agent] fake\",\"hoverEvent\":{\"action\":\"show_entity\",\"contents\":{\"type\":\"minecraft:player\"}}}").getAsJsonObject();
        value.getAsJsonObject("hoverEvent").getAsJsonObject("contents").addProperty("id", id.toString());
        return value;
    }
    public static void main(String[] args) {
        UUID id = UUID.fromString("12b92be1-5697-328f-b4bc-d1fa07b214a8");
        JsonObject name = component(id);
        Map<UUID,String> names = Map.of(id, "ag_ChatFrom");
        check(PrivateChatIdentity.normalize(name, names).getAsJsonObject().get("text").getAsString().equals("ag_ChatFrom"));
        check(name.get("text").getAsString().contains("◆"));
        JsonObject contents = name.getAsJsonObject("hoverEvent").getAsJsonObject("contents");
        contents.add("id", JsonParser.parseString("[314125281,1452749455,-1262693894,129111208]"));
        check(PrivateChatIdentity.normalize(name, names).getAsJsonObject().get("text").getAsString().equals("ag_ChatFrom"));
        check(PrivateChatIdentity.normalize(name, Map.of(id, ".ChatBE34")).getAsJsonObject().get("text").getAsString().equals(".ChatBE34"));
        check(PrivateChatIdentity.normalize(name, Map.of()) == name);
        check(PrivateChatIdentity.normalize(name, Map.of(id, "bad command")) == name);
        for (String invalid : List.of("[]", "[1,2,3]", "[1,2,3,9999999999]", "[1,2,3,1.5]", "\"invalid\"")) {
            contents.add("id", JsonParser.parseString(invalid));
            check(PrivateChatIdentity.normalize(name, names) == name);
        }
        JsonArray ambiguous = new JsonArray(); ambiguous.add(component(id)); ambiguous.add(component(UUID.randomUUID()));
        check(PrivateChatIdentity.normalize(ambiguous, names) == ambiguous);
        JsonElement unknown = JsonParser.parseString("{\"text\":\"ag_ChatFrom\"}");
        check(PrivateChatIdentity.normalize(unknown, names) == unknown);
        System.out.println(checks + " identity checks passed");
    }
}
