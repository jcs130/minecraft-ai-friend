package org.afuhome.agentfriend;

import java.nio.file.Files;
import java.util.List;
import java.util.UUID;
import org.bukkit.configuration.file.YamlConfiguration;

public final class LocalTaskChainsTest {
    private static int checks;
    private static void check(boolean value, String label) { checks++; if (!value) throw new AssertionError(label); }
    private static void rejects(Runnable operation) { try { operation.run(); throw new AssertionError("invalid area accepted"); } catch (IllegalArgumentException expected) { checks++; } }
    private static java.util.Map<String,Object> leaves(YamlConfiguration yaml) {
        var out=new java.util.TreeMap<String,Object>(); yaml.getValues(true).forEach((k,v)->{if(!(v instanceof org.bukkit.configuration.ConfigurationSection))out.put(k,v);}); return out;
    }
    public static void main(String[] args) throws Exception {
        var area = new SurveyArea("公共矿棚", -666, 65, -496, -642, 76, -472);
        check(area.contains(-666,65,-496) && area.contains(-641.01,76.99,-471.01), "whole boundary blocks, including negative coordinates");
        for (double[] at : new double[][]{{-666.01,68,-484},{-641,68,-484},{-652,64.99,-484},{-652,77,-484},{-652,68,-496.01},{-652,68,-471},{Double.NaN,68,-484},{0,0,0}})
            check(!area.contains(at[0],at[1],at[2]), "outside or unknown coordinates rejected");
        check(area.json().getAsJsonArray("min").get(1).getAsInt()==65 && area.conditions().contains("含边界"), "vertical bounds discoverable");
        check(!area.contains("other_world",-652,68,-484) && area.contains("world",-652,68,-484), "same coordinates in another normal world are not the local destination");
        rejects(()->new SurveyArea("坏范围",0,0,0,-1,10,10));
        rejects(()->new SurveyArea("坏高度",0,-65,0,1,10,1));
        rejects(()->new SurveyArea("无限范围",0,0,0,2000,10,1));
        rejects(()->new SurveyArea("",0,0,0,1,1,1));
        var parsed = new YamlConfiguration(); parsed.loadFromString("dimension: overworld\narea: {name: 小范围, min-x: -2, min-y: 60, min-z: -2, max-x: 2, max-y: 70, max-z: 2}\n");
        check(SurveyArea.parse(parsed).contains(0,65,0), "nested YAML section accepted");
        var map = new YamlConfiguration(); map.set("area", parsed.getConfigurationSection("area").getValues(false));
        check(SurveyArea.parse(map).equals(SurveyArea.parse(parsed)), "raw step map and frozen YAML agree");
        map.set("area", "bad"); rejects(()->SurveyArea.parse(map));
        parsed.set("area.min-x",1.5); rejects(()->SurveyArea.parse(parsed));
        var legacy = new ExplorationObjectives.Target(GuildManager.Goal.DIMENSION,"overworld",List.of(),16,48,15,0,1,0);
        check(legacy.area()==null && !legacy.json().has("area"), "old constructor keeps unbounded frozen rules");
        parsed.loadFromString("dimension: overworld\narea: {name: 回村, min-x: -548, min-y: 65, min-z: -443, max-x: -534, max-y: 73, max-z: -428}\n");
        var returned=ExplorationObjectives.parse(GuildManager.Goal.RETURN,parsed,1);
        check(returned.area().contains(-541,67,-435) && returned.conditions(1).contains("本人实际位置"), "local return requires actual bounded destination");
        parsed.set("min-height-span",20); parsed.set("min-distance",8); parsed.set("min-seconds",5);
        rejects(()->ExplorationObjectives.parse(GuildManager.Goal.DIMENSION,parsed,2));
        var resources=java.nio.file.Path.of(args[0]);
        var routes=YamlConfiguration.loadConfiguration(resources.resolve("route-contracts.yml").toFile());
        var market=YamlConfiguration.loadConfiguration(resources.resolve("task-market.yml").toFile());
        check(routes.getMapList("tasks.local_mine_journal.steps").size()==5, "mine chain has five real stages");
        check(routes.getMapList("tasks.local_village_notes.steps").size()==3, "surface alternative does not require mining");
        check(market.getInt("tasks.ancient_city_silence.min-rank")==3 && market.getString("tasks.ancient_city_silence.description").contains("六千"), "ancient city offer discloses level and distance");
        for (String id:List.of("local_mine_journal","local_village_notes")) for(var row:routes.getMapList("tasks."+id+".steps")) {
            var step=new YamlConfiguration(); row.forEach((k,v)->step.set(String.valueOf(k),v));
            if(step.getString("goal").equals("craft")) continue;
            var bounds=SurveyArea.parse(step); check(bounds!=null, "all local travel stages bounded");
            check(Math.abs(bounds.minX()+544)<200 && Math.abs(bounds.minZ()+438)<100, "within verified village neighbourhood");
            var target=ExplorationObjectives.parse(GuildManager.Goal.valueOf(step.getString("goal").toUpperCase()),step,step.getInt("target"));
            check(target.area().equals(bounds), "bounds survive target parsing");
        }
        var config=new YamlConfiguration(); UUID owner=UUID.randomUUID(),other=UUID.randomUUID();String root=ExplorationPauseStore.root(owner);
        config.set(root+".active.id","tm_ancient_city_silence");config.set(root+".active.progress",4);
        config.set(root+".active.market.definition","task: original frozen ancient city\n");
        config.set(root+".active.market.step",0);config.set(root+".active.market.run","original-token");
        config.set(root+".active.market.exploration","{\"distance\":36,\"zones\":[\"one\",\"two\"]}");
        config.set(root+".fame",24);config.set(ExplorationPauseStore.root(other)+".active.id","unrelated");
        String before=config.saveToString();var directory=Files.createTempDirectory("local-task-journal-");var file=directory.resolve("config.yml");Files.writeString(file,before);
        try {
            check(ExplorationPauseStore.move(config,file,owner,true), "pause durably commits");
            check(!config.contains(root+".active") && ExplorationPauseStore.present(config,owner), "pause frees only active slot");
            var frozen=ExplorationPauseStore.read(config,owner);
            check(frozen.getInt("progress")==4 && frozen.getString("market.run").equals("original-token") && frozen.getString("market.exploration").contains("36"), "count, run and evidence preserved");
            var restarted=YamlConfiguration.loadConfiguration(file.toFile());
            check(ExplorationPauseStore.read(restarted,owner).saveToString().equals(frozen.saveToString()), "disk reload preserves paused record");
            check(!ExplorationPauseStore.move(config,file,owner,true), "repeat cannot overwrite pause");
            config.set(root+".active.id","tm_local_mine_journal");
            check(!ExplorationPauseStore.move(config,file,owner,false) && config.getString(root+".active.id").equals("tm_local_mine_journal"), "resume cannot destroy another task");
            config.set(root+".active",null);
            check(ExplorationPauseStore.move(config,file,owner,false), "resume durably commits");
            var original=new YamlConfiguration();original.loadFromString(before);
            check(leaves(config).equals(leaves(original)), "entire snapshot, other player and fame round trip unchanged");
            String beforeFailure=config.saveToString();
            var blocked=directory.resolve("cannot-replace");Files.createDirectory(blocked);Files.writeString(blocked.resolve("keep"),"original");
            check(!ExplorationPauseStore.move(config,blocked,owner,true), "save failure is not success");
            check(config.saveToString().equals(beforeFailure) && Files.readString(blocked.resolve("keep")).equals("original"), "failure preserves memory and storage");
            check(!Files.exists(directory.resolve("cannot-replace.exploration-pause.tmp")), "failed temporary write removed");
            Files.delete(blocked.resolve("keep"));Files.delete(blocked);
        } finally { Files.deleteIfExists(file);Files.delete(directory); }
        System.out.println("LocalTaskChainsTest: "+checks+" passed");
    }
}
