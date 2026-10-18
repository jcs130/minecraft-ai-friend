package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.bukkit.configuration.file.YamlConfiguration;

/** Exercises the guidance against every goal and the actual operator task files. */
public final class TaskProgressGuidanceTest {
    private static int checks;
    private static void check(String name, boolean condition) {
        if (!condition) throw new AssertionError(name); checks++;
    }
    private static GuildManager.Contract contract(GuildManager.Goal goal) {
        return new GuildManager.Contract("test", "测试阶段", "冻结原条件", null, goal, 5, 3, 0, 1, 1, null, 1, "WHEAT");
    }
    public static void main(String[] args) throws Exception {
        for (var goal : GuildManager.Goal.values()) {
            var q=contract(goal);var g=TaskProgressGuidance.guide(q,2,null,"",new JsonObject());
            check(goal+" retains count",g.get("current").getAsInt()==2&&g.get("remaining").getAsInt()==3);
            check(goal+" action and query",g.get("nextAction").getAsString().length()>12&&g.get("nextCommand").getAsString().startsWith("/mycli "));
            check(goal+" not ready from partial count",!g.get("ready").getAsBoolean()&&g.getAsJsonArray("missingConditions").size()>0);
            check(goal+" query explicitly read only",g.get("readOnly").getAsBoolean()&&g.getAsJsonArray("objectives").size()==2);
            g=TaskProgressGuidance.guide(q,5,null,"ready",new JsonObject());
            check(goal+" stage complete still requires own claim",g.get("ready").getAsBoolean()&&g.get("nextCommand").getAsString().equals("/mycli guild claim")&&g.get("nextAction").getAsString().contains("阶段"));
            if(EngineeringSites.GOALS.contains(goal))check(goal+" count alone cannot verify a structure",!TaskProgressGuidance.guide(q,5,null,"",new JsonObject()).get("ready").getAsBoolean());
        }
        var spec=new CombatObjectives.Spec(Set.of("SPIDER","CAVE_SPIDER"),Set.of("SWORD","AXE"),"melee");
        check("same species individuals allowed",spec.matches("SPIDER","STONE_SWORD","melee")&&spec.matches("SPIDER","IRON_AXE","melee"));
        check("classify target mismatch",spec.mismatch("ZOMBIE","IRON_SWORD","melee").equals("TARGET_MISMATCH"));
        check("classify spell or projectile mismatch",spec.mismatch("SPIDER","IRON_SWORD","magic").equals("ATTACK_METHOD_MISMATCH"));
        check("classify wrong weapon",spec.mismatch("SPIDER","STICK","melee").equals("WEAPON_MISMATCH"));
        check("valid proof not rejected",spec.mismatch("SPIDER","STONE_AXE","melee").isEmpty());
        var combat=spec.json();String original=combat.toString();
        String action=TaskProgressGuidance.combatRequirement(combat);
        check("choices are OR and native last hit",action.contains("任选")&&action.contains("同种")&&action.contains("最后一击")&&action.contains("法术和环境伤害不计"));
        TaskProgressGuidance.guide(contract(GuildManager.Goal.KILLS),3,combat,"",new JsonObject());
        check("frozen combat requirements not mutated",original.equals(combat.toString()));
        var first=new TaskProgressGuidance.Notice("run:0","PROGRESS_RECORDED",1,10_000);
        check("first receipt immediate",TaskProgressGuidance.shouldNotify(null,first));
        check("duplicate result throttled",!TaskProgressGuidance.shouldNotify(first,new TaskProgressGuidance.Notice("run:0","PROGRESS_RECORDED",1,11_000)));
        check("rapid gathering coalesced",!TaskProgressGuidance.shouldNotify(first,new TaskProgressGuidance.Notice("run:0","PROGRESS_RECORDED",20,11_000)));
        check("new stage immediate",TaskProgressGuidance.shouldNotify(first,new TaskProgressGuidance.Notice("run:1","PROGRESS_RECORDED",1,11_000)));
        check("new rejection immediate",TaskProgressGuidance.shouldNotify(first,new TaskProgressGuidance.Notice("run:0","WEAPON_MISMATCH",1,11_000)));
        check("later update visible",TaskProgressGuidance.shouldNotify(first,new TaskProgressGuidance.Notice("run:0","PROGRESS_RECORDED",4,20_000)));
        check("clock rollback not permanent silence",TaskProgressGuidance.shouldNotify(first,new TaskProgressGuidance.Notice("run:0","PROGRESS_RECORDED",1,100)));
        for(String reason:List.of("TARGET_MISMATCH","WEAPON_MISMATCH","ATTACK_METHOD_MISMATCH","MELEE_EVIDENCE_MISSING","PROJECTILE_EVIDENCE_MISSING","WRONG_ITEM_OR_SITE"))
            check(reason+" corrective advice",TaskProgressGuidance.rejectedHint(reason,combat).length()>40);
        var required=contract(GuildManager.Goal.PEAK);
        check("height task accepts a roof",TaskProgressGuidance.guide(required,0,null,"",new JsonObject()).get("nextAction").getAsString().contains("屋顶"));
        check("photo task needs neither map nor upload",TaskProgressGuidance.guide(contract(GuildManager.Goal.PHOTO),0,null,"",new JsonObject()).get("nextAction").getAsString().contains("无需截图"));
        var evidence=new JsonObject();evidence.addProperty("failedEarlierStep",1);
        var blocked=TaskProgressGuidance.guide(contract(GuildManager.Goal.DONATE),5,null,"bridge_not_connected",evidence);
        check("full inventory does not conceal broken earlier structure",!blocked.get("ready").getAsBoolean()&&blocked.get("phase").getAsString().equals("repair_earlier_stage"));
        check("repair keeps prior count and names earlier stage",blocked.get("current").getAsInt()==5&&blocked.get("nextAction").getAsString().contains("第 1 阶段"));
        var remote=TaskProgressGuidance.guide(contract(GuildManager.Goal.BRIDGE),0,null,"not_at_site",new JsonObject());
        check("remote building check directs to coordinates before another verify",remote.get("phase").getAsString().equals("reach_site")&&remote.get("nextCommand").getAsString().equals("/mycli guild engineering test")&&remote.get("nextAction").getAsString().contains("实际到场"));
        var fasting=TaskProgressGuidance.guide(contract(GuildManager.Goal.FAST_FLOOR),0,null,"",new JsonObject()).get("nextAction").getAsString();
        check("FAST_FLOOR is fasting rather than a speed run",fasting.contains("禁食")&&!fasting.contains("计时"));
        var scholarship=TaskProgressGuidance.guide(contract(GuildManager.Goal.ERUDITE),0,null,"",new JsonObject()).get("nextAction").getAsString();
        check("ERUDITE refers to historical ability dimensions",scholarship.contains("能力维度")&&scholarship.contains("历史")&&scholarship.contains("只能接一单"));
        var healing=TaskProgressGuidance.guide(contract(GuildManager.Goal.HEALING),0,null,"",new JsonObject()).get("nextAction").getAsString();
        check("healing trial requires an ally monster wound",healing.contains("怪物打伤的队友")&&healing.contains("治疗自己"));
        var legacyField=GuildManager.class.getDeclaredField("CONTRACTS");legacyField.setAccessible(true);
        var legacy=(List<?>)legacyField.get(null);
        for(Object value:legacy) {
            var q=(GuildManager.Contract)value;var g=TaskProgressGuidance.guide(q,0,null,"",new JsonObject());
            check("legacy "+q.id()+" receives an action",!g.get("nextAction").getAsString().isBlank());
            check("legacy "+q.id()+" has no nonexistent floor zero",!g.get("nextAction").getAsString().contains("第 0 层"));
        }

        int tasks=0,stages=0;
        for(String name:List.of("task-market.yml","route-contracts.yml","resident-contracts.yml")) {
            var file=YamlConfiguration.loadConfiguration(Path.of(args[0],name).toFile());var section=file.getConfigurationSection("tasks");
            if(section==null)throw new AssertionError("Missing tasks in "+name);
            for(String id:section.getKeys(false)) {
                tasks++;
                for(Map<?,?> raw:section.getMapList(id+".steps")) {
                    stages++;var goal=GuildManager.Goal.valueOf(raw.get("goal").toString().toUpperCase(java.util.Locale.ROOT));
                    var g=TaskProgressGuidance.guide(contract(goal),0,raw.containsKey("combat")?CombatObjectives.parse(raw.get("combat")).json():null,"",new JsonObject());
                    check(name+":"+id+" actionable",!g.get("nextAction").getAsString().isBlank()&&!g.get("ready").getAsBoolean());
                    check(name+":"+id+" current requirement present",raw.get("description") instanceof String text&&!text.isBlank());
                }
            }
        }
        check("all current task families audited",tasks>=53&&stages>=91);
        System.out.println("TaskProgressGuidanceTest: "+checks+" passed; "+GuildManager.Goal.values().length+" goals, "+tasks+" configured tasks, "+stages+" stages, "+legacy.size()+" legacy tasks");
    }
}
