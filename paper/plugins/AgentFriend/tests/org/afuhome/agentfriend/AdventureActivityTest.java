package org.afuhome.agentfriend;
import java.io.File;
import java.util.List;
import org.bukkit.configuration.file.YamlConfiguration;

public final class AdventureActivityTest {
    private static int checks;
    private static void check(String name,boolean value){if(!value)throw new AssertionError(name);checks++;}
    public static void main(String[] args)throws Exception{
        File root=new File(args[0]);
        for(String id:List.of("farmer_harvest","harvest_home","tm_field_cycle","tm_vegetable_cycle"))check("retired "+id,RetiredActivities.retired(id));
        for(String id:List.of("tm_starter_trail","tm_starter_blade","tm_crypt_report","author_story","trader_supply"))check("retained "+id,!RetiredActivities.retired(id));
        check("retired daily can preserve progress without abandoning",RetiredActivities.pausable("tm_field_cycle",false,false,false));
        check("new daily tasks still cannot pause",!RetiredActivities.pausable("tm_crypt_report",false,false,false));
        check("project cannot pause",!RetiredActivities.pausable("tm_field_cycle",true,false,false));
        check("old exploration pause retained",RetiredActivities.pausable("tm_starter_trail",false,true,true));
        for(String file:List.of("task-market.yml","resident-contracts.yml","route-contracts.yml")){
            var y=new YamlConfiguration();y.load(new File(root,file));
            for(String key:y.getConfigurationSection("tasks").getKeys(false)){
                var t=y.getConfigurationSection("tasks."+key);
                boolean crop=t.getMapList("steps").stream().anyMatch(s->List.of("harvest","replant").contains(s.get("goal")));
                if(crop)check("crop task withdrawn "+key,!t.getBoolean("enabled",true));
            }
        }
        var board=new YamlConfiguration();board.load(new File(root,"world-life.yml"));
        check("no crop board cards",board.getStringList("contracts").stream().noneMatch(RetiredActivities::retired));
        for(String id:List.of("tm_starter_tower","tm_crypt_report","tm_local_village_notes"))check("adventure remains discoverable "+id,board.getStringList("contracts").contains(id));
        var story=RpgStoryContent.load(new File(root,"rpg-story.yml"));
        check("no farm side quest",story.sides.stream().flatMap(s->s.contracts().stream()).noneMatch(RetiredActivities::retired));
        check("no farm NPC offers",story.npcs.stream().flatMap(n->n.offers().stream()).noneMatch(RetiredActivities::retired));
        check("creative life route",TaskRouteCatalog.find("life").description().contains("游记")&&!TaskRouteCatalog.find("life").description().contains("种植"));
        System.out.println("AdventureActivityTest: "+checks+" passed");
    }
}
