package org.afuhome.agentfriend;

import java.io.File;
import java.util.*;
import org.bukkit.ChatColor;
import org.bukkit.Material;
import org.bukkit.attribute.Attribute;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.*;
import org.bukkit.inventory.ItemStack;

/** Bounded vanilla enemies; no world-generating or client-side dependency. */
final class DungeonWaveCatalog {
    static final Set<EntityType> ALLOWED=Set.of(EntityType.ZOMBIE,EntityType.HUSK,EntityType.DROWNED,
            EntityType.SKELETON,EntityType.STRAY,EntityType.WITHER_SKELETON,EntityType.SPIDER,
            EntityType.CAVE_SPIDER,EntityType.WITCH,EntityType.PILLAGER,EntityType.VINDICATOR,
            EntityType.BLAZE,EntityType.MAGMA_CUBE,EntityType.RAVAGER);
    record Enemy(EntityType type,double health,String name) {
        Map<String,Object> saved(){return Map.of("type",type.name(),"health",health,"name",name);}
        void equip(Mob mob,double scale) {
            mob.setPersistent(true);mob.setRemoveWhenFarAway(false);mob.setAI(true);
            if(mob instanceof Zombie zombie)zombie.setBaby(false);
            if(mob instanceof MagmaCube cube)cube.setSize(1);
            Material weapon=switch(type){
                case SKELETON,STRAY->Material.BOW;case PILLAGER->Material.CROSSBOW;
                case VINDICATOR->Material.IRON_AXE;case WITHER_SKELETON->Material.STONE_SWORD;
                case ZOMBIE,HUSK->Material.IRON_SWORD;case DROWNED->Material.TRIDENT;
                default->Material.AIR;
            };
            if(mob.getEquipment()!=null){
                mob.getEquipment().setItemInMainHand(weapon==Material.AIR?null:new ItemStack(weapon));
                mob.getEquipment().setItemInMainHandDropChance(0);
                mob.getEquipment().setHelmetDropChance(0);mob.getEquipment().setChestplateDropChance(0);
                mob.getEquipment().setLeggingsDropChance(0);mob.getEquipment().setBootsDropChance(0);
            }
            var attribute=mob.getAttribute(Attribute.GENERIC_MAX_HEALTH);
            if(attribute!=null&&(health>0||scale!=1)){double value=(health>0?health:attribute.getBaseValue())*scale;attribute.setBaseValue(value);mob.setHealth(value);}
            if(!name.isEmpty()){mob.setCustomName(ChatColor.GOLD+name);mob.setCustomNameVisible(true);}
        }
    }
    private final AgentFriendPlugin plugin;
    private Map<Integer,List<Enemy>> waves=Map.of();
    DungeonWaveCatalog(AgentFriendPlugin plugin){this.plugin=plugin;if(!new File(plugin.getDataFolder(),"trial-waves.yml").exists())plugin.saveResource("trial-waves.yml",false);reload();}
    String reload(){
        try{
            var yaml=new YamlConfiguration();yaml.load(new File(plugin.getDataFolder(),"trial-waves.yml"));
            if(yaml.getInt("schema-version")!=1)throw new IllegalArgumentException("schema_version");
            ConfigurationSection section=yaml.getConfigurationSection("floors");if(section==null)throw new IllegalArgumentException("floors_missing");
            Map<Integer,List<Enemy>> next=new LinkedHashMap<>();
            for(String key:section.getKeys(false)){int floor=Integer.parseInt(key);if(floor<1||floor>15||floor==7)throw new IllegalArgumentException("invalid_floor");next.put(floor,parse(section.getList(key)));}
            waves=Map.copyOf(next);return "success";
        }catch(Exception e){plugin.getLogger().warning("Trial wave configuration retained: "+e.getMessage());return "invalid_configuration";}
    }
    List<Enemy> wave(int floor,EntityType[] fallback,boolean enhanced){
        List<Enemy> legacy=Arrays.stream(fallback).map(t->new Enemy(t,0,"")).toList();
        return enhanced?waves.getOrDefault(floor,legacy):legacy;
    }
    int configuredFloors(){return waves.size();}
    static List<Enemy> parse(List<?> entries){
        if(entries==null||entries.isEmpty())throw new IllegalArgumentException("empty_wave");List<Enemy> result=new ArrayList<>();
        for(Object entry:entries){
            String raw;double health=0;String name="";int count=1;
            if(entry instanceof String s)raw=s;
            else if(entry instanceof Map<?,?> m){raw=Objects.toString(m.get("type"),"");if(m.containsKey("health"))health=Double.parseDouble(m.get("health").toString());if(m.containsKey("name"))name=m.get("name").toString();if(m.containsKey("count"))count=Integer.parseInt(m.get("count").toString());}
            else throw new IllegalArgumentException("invalid_enemy");
            EntityType type=EntityType.valueOf(raw.toUpperCase(Locale.ROOT).replace("MINECRAFT:",""));
            if(!ALLOWED.contains(type)||!Double.isFinite(health)||health!=0&&(health<10||health>500)||name.length()>32||count<1||count>12)throw new IllegalArgumentException("invalid_enemy");
            for(int i=0;i<count;i++)result.add(new Enemy(type,health,name));
        }
        if(result.size()>12)throw new IllegalArgumentException("wave_limit_12");return List.copyOf(result);
    }
}
