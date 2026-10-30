package dev.qiandeng.maw.saoforge;

import java.util.Map;
import java.util.Set;

/** Only the reviewed optional Numen UI integrations; other requirements stay intact. */
public final class OptionalStatusPolicy {
    public static final String NUMEN_VERSION="0.1.4.1";
    public static final Set<String> MODS=Set.of("numen","numen_api");
    public static final Map<String,String> CHANNELS=Map.of("numen_api:main","1","numen_tlm:outfit","1");

    public static boolean supported(boolean dedicated,Map<String,String> mods,Map<String,String> channels){
        if(!dedicated||!mods.containsKey("maw_numen_server")||!MODS.stream().allMatch(id->NUMEN_VERSION.equals(mods.get(id))))return false;
        if(!CHANNELS.get("numen_api:main").equals(channels.get("numen_api:main")))return false;
        return CHANNELS.entrySet().stream().allMatch(e->!channels.containsKey(e.getKey())||e.getValue().equals(channels.get(e.getKey())));
    }
    private OptionalStatusPolicy(){}
}
