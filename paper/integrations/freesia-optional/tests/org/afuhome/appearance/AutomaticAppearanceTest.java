package org.afuhome.appearance;

import com.google.gson.Gson;
import java.nio.file.*;
import java.util.*;

public final class AutomaticAppearanceTest {
    private static int checks;
    private static final Gson JSON = new Gson();
    private static final Map<String,List<String>> CATALOG = Map.of("first",List.of("t"),"second",List.of("t"),"third",List.of("t"));
    private static void check(boolean value, String message) { checks++; if (!value) throw new AssertionError(message); }
    private static Path settings(boolean enabled, List<String> pool, List<UUID> excluded) throws Exception {
        Path root = Files.createTempDirectory("ysm-auto-test-");
        Path config = root.resolve("models.json");
        Files.writeString(config, JSON.toJson(Map.of("automaticAssignment",Map.of("enabled",enabled,
            "models",pool.stream().map(id -> Map.of("model",id,"texture","t")).toList(),"excludedUuids",excluded))));
        return config;
    }
    private static AutomaticAppearance policy(Path config) { var value = new AutomaticAppearance(config); value.reload(); return value; }
    private static UUID id(int n) { return new UUID(3,n); }
    private static Map<String,Object> row(UUID id, String model) { return Map.of("playerUuid",id.toString(),"modelId",model,"available",true); }
    private static AutomaticAppearance.Action tick(AutomaticAppearance p, SelfAppearance selections, UUID id, Object connection, long now, Collection<Map<String,Object>> observed) {
        return p.tick(id,connection,1,"Actor"+id.getLeastSignificantBits(),true,1,"default","default",CATALOG,observed,selections,now);
    }
    public static void main(String[] args) throws Exception {
        Object connection = new Object();
        Path config = settings(true,List.of("first","second"),List.of(id(9)));
        var p = policy(config); var selections = new SelfAppearance();
        check(tick(p,selections,id(1),connection,1,List.of())==null,"wait for native state to settle");
        check(tick(p,selections,id(1),connection,4999,List.of())==null,"no premature initial assignment");
        var first = tick(p,selections,id(1),connection,6001,List.of());
        check(first!=null && first.selection()!=null,"initial choice dispatched once");
        String firstModel=first.selection().model();
        check(first.selection().command().endsWith("false"),"native self-selection permission semantics retained");
        check(p.status(id(1)).get("phase").equals("issued"),"dispatch is not application");
        check(tick(p,selections,id(1),connection,7001,List.of())==null,"no duplicate while pending");
        tick(p,selections,id(2),connection,1,List.of());
        check(tick(p,selections,id(2),connection,8001,List.of())==null,"global transfer cadence bounded");
        var second=tick(p,selections,id(2),connection,9001,List.of(row(id(1),"default")));
        check(second!=null && !second.selection().model().equals(firstModel),"pending assignment reserves its model despite default readback");
        tick(p,selections,id(3),connection,1,List.of());
        var third=tick(p,selections,id(3),connection,12001,List.of());
        check(third!=null && third.message().contains("用满"),"only reuse after every compatible model is occupied, with an explicit explanation");
        check(p.tick(id(1),connection,1,"Actor1",true,1,firstModel,"t",CATALOG,List.of(),selections,13001)!=null,"real matching native observation confirms application");
        check(p.status(id(1)).get("phase").equals("applied"),"applied is readback-based");
        p.left(id(1));
        check(tick(p,selections,id(1),new Object(),20000,List.of())==null,"reconnect never rerolls an existing identity");
        var restarted=policy(config);
        check(tick(restarted,new SelfAppearance(),id(1),new Object(),25000,List.of())==null,"application persists through plugin restart");
        check(restarted.status(id(1)).get("model").equals(firstModel),"same UUID retains its saved choice");
        check(tick(restarted,new SelfAppearance(),id(2),new Object(),25000,List.of())==null,"unknown prior dispatch is not replayed");
        restarted.unknown(id(1));
        check(restarted.status(id(1)).get("phase").equals("applied"),"late failed callback cannot overwrite confirmed application");
        check(tick(p,selections,id(9),connection,1,List.of())==null && tick(p,selections,id(9),connection,20000,List.of())==null,"known observers excluded");
        check(p.status(id(9)).get("phase").equals("excluded"),"observer status explicit");

        var manual=policy(settings(true,List.of("first","second","third"),List.of()));
        manual.tick(id(4),connection,1,"Actor4",true,1,"first","t",CATALOG,List.of(),new SelfAppearance(),1);
        check(tick(manual,new SelfAppearance(),id(4),connection,6001,List.of())==null,"pre-existing custom selection protected");
        manual.manual(id(5),"default","default",1);
        check(tick(manual,new SelfAppearance(),id(5),connection,6001,List.of())==null,"explicit default selection is respected");
        tick(manual,new SelfAppearance(),id(6),connection,1,List.of());
        var avoid=tick(manual,new SelfAppearance(),id(6),connection,6001,List.of(row(id(7),"second")));
        check(avoid.selection().model().equals("third"),"both persisted offline choices and live choices are reserved");
        var unavailable=policy(settings(true,List.of("first"),List.of()));
        check(unavailable.tick(id(1),connection,1,"Actor1",false,1,"default","default",CATALOG,List.of(),new SelfAppearance(),6001)==null,"login required");
        check(unavailable.tick(id(1),connection,1,"Actor1",true,2,"default","default",CATALOG,List.of(),new SelfAppearance(),6001)==null,"single native worker required");
        check(unavailable.tick(id(1),connection,1,"Actor1",true,1,null,null,CATALOG,List.of(),new SelfAppearance(),6001)==null,"unknown is not an unassigned default");
        tick(unavailable,new SelfAppearance(),id(1),connection,1,List.of());
        check(unavailable.tick(id(1),connection,1,"Actor1",true,1,"default","default",Map.of(),List.of(),new SelfAppearance(),6001)==null,"unavailable catalog does not dispatch");

        Path disabledConfig=settings(false,List.of("first"),List.of());var disabled=policy(disabledConfig);
        tick(disabled,new SelfAppearance(),id(1),connection,1,List.of());tick(disabled,new SelfAppearance(),id(1),connection,6001,List.of());
        check(!Files.exists(disabledConfig.resolveSibling("automatic-appearances.json")),"disabled feature leaves no new ledger");
        Path brokenConfig=settings(true,List.of("first"),List.of());Path brokenFile=brokenConfig.resolveSibling("automatic-appearances.json");
        Files.writeString(brokenFile,"bad prior state");var broken=policy(brokenConfig);
        tick(broken,new SelfAppearance(),id(1),connection,1,List.of());
        check(tick(broken,new SelfAppearance(),id(1),connection,6001,List.of())==null,"corrupt history fails closed");
        check(Files.readString(brokenFile).equals("bad prior state"),"corrupt state is not overwritten");

        Path failConfig=settings(true,List.of("first"),List.of());var failing=policy(failConfig);var owner=new SelfAppearance();
        tick(failing,owner,id(1),connection,1,List.of());Files.createDirectory(failConfig.resolveSibling("automatic-appearances.json"));
        check(tick(failing,owner,id(1),connection,6001,List.of())==null,"no dispatch without durable reservation");
        check(owner.begin(id(1),connection,1,"Actor1",true,1,CATALOG,new String[]{"set","second","t"},6002).selection()!=null,"failed reservation releases only its own unsent selection");

        var cooldown=policy(settings(true,List.of("first","second"),List.of()));
        var existing=new SelfAppearance();existing.begin(id(1),connection,1,"Actor1",true,1,CATALOG,new String[]{"set","third","t"},1);
        tick(cooldown,existing,id(1),connection,1,List.of());
        check(tick(cooldown,existing,id(1),connection,6001,List.of())==null,"pending personal change wins over automatic setup");
        check(cooldown.status(id(1)).get("phase").equals("unassigned"),"rejected attempt is not reserved as an assignment");
        Path registryConfig=settings(true,List.of("first"),List.of());
        Path registry=registryConfig.resolveSibling("roles.json");
        Files.writeString(registry,JSON.toJson(Map.of("schema",1,"accounts",List.of(Map.of("uuid",id(12).toString(),"kind","observer","source","owner_confirmation")))));
        var registrySettings=com.google.gson.JsonParser.parseString(Files.readString(registryConfig)).getAsJsonObject();
        registrySettings.getAsJsonObject("automaticAssignment").addProperty("observerRegistryFile",registry.toAbsolutePath().toString());
        Files.writeString(registryConfig,registrySettings.toString());
        var registered=policy(registryConfig);
        check(tick(registered,new SelfAppearance(),id(12),connection,1,List.of())==null && tick(registered,new SelfAppearance(),id(12),connection,6001,List.of())==null,"registered observer excluded by UUID without a name prefix");
        check(registered.status(id(12)).get("phase").equals("excluded"),"shared observer registry is reflected in status");
        String rolesBefore=Files.readString(registry);
        registered.reload();check(Files.readString(registry).equals(rolesBefore),"appearance never changes maintenance or login permissions");
        Files.writeString(registry,"invalid registry");registered.reload();
        tick(registered,new SelfAppearance(),id(13),connection,1,List.of());
        check(tick(registered,new SelfAppearance(),id(13),connection,6001,List.of())==null,"invalid observer evidence disables automatic changes");
        check(registered.status(id(13)).get("reason").equals("AUTO_APPEARANCE_CONFIG_INVALID"),"invalid observer registry is explicit");
        System.out.println("AutomaticAppearanceTest: "+checks+" checks passed");
    }
}
