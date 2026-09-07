package dev.qiandeng.irons;

import java.util.List;
import java.util.UUID;

public final class ActorLookupTest {
    record Actor(UUID id, String name) {}
    private static int checks;
    private static void check(boolean value, String label) {
        if (!value) throw new AssertionError(label);
        checks++;
    }
    private static ActorLookup.Result<Actor> lookup(String key, List<Actor> actors) {
        return ActorLookup.resolve(key, actors, Actor::id, Actor::name);
    }
    public static void main(String[] args) {
        var real = new Actor(UUID.fromString("00000000-0000-0000-0000-000000000001"), "Probe");
        var numen = new Actor(UUID.fromString("00000000-0000-0000-0000-000000000002"), "Probe");
        check(lookup("probe", List.of(real)).actor() == real, "Case-insensitive exact name");
        check(lookup("Pro", List.of(real)).code().equals("actor_not_found"), "No prefix matching");
        check(lookup("@a", List.of(real)).code().equals("actor_not_found"), "No mass selector");
        check(lookup("Probe", List.of(real, real)).actor() == real, "PlayerList/entity duplicate UUID deduplicated");
        check(lookup("Probe", List.of(real, numen)).code().equals("ambiguous_actor"), "Duplicate real/Numen names rejected");
        check(lookup(numen.id().toString(), List.of(real, numen)).actor() == numen, "UUID targets the correct duplicate name");
        check(lookup("00000000-0000-0000-0000-000000000003", List.of(real)).code().equals("actor_not_found"), "Missing UUID never falls back");
        check(lookup("Probe", List.of()).code().equals("actor_not_found"), "Empty world handled");
        System.out.println("{\"ok\":true,\"checks\":" + checks + ",\"suite\":\"actor-lookup\"}");
    }
}
