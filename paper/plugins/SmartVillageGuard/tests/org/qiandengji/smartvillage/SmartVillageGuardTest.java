package org.qiandengji.smartvillage;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public final class SmartVillageGuardTest {
    public static void main(String[] args) {
        Set<String> names = Set.of("村庄补给商", "远行货郎·灯穗");
        Map<String, UUID> bodies = new HashMap<>();
        UUID first = UUID.randomUUID();
        UUID duplicate = UUID.randomUUID();
        UUID replacement = UUID.randomUUID();
        if (!SmartVillageGuardPlugin.allowServiceBody("村庄补给商", first, names, bodies, id -> true))
            throw new AssertionError("first service body must be kept");
        if (SmartVillageGuardPlugin.allowServiceBody("村庄补给商", duplicate, names, bodies, id -> true))
            throw new AssertionError("duplicate service body must be removed");
        if (!SmartVillageGuardPlugin.allowServiceBody("村庄补给商", first, names, bodies, id -> true))
            throw new AssertionError("canonical service body must stay");
        if (!SmartVillageGuardPlugin.allowServiceBody("村庄补给商", replacement, names, bodies, id -> false))
            throw new AssertionError("dead canonical service body must be replaceable");
        if (SmartVillageGuardPlugin.allowServiceBody("无关村民", replacement, names, bodies, id -> false))
            throw new AssertionError("unknown villager must not be treated as a service body");
        System.out.println("passed=true");
    }
}
