package org.afuhome.agentfriend;

import java.util.*;
import java.util.random.RandomGenerator;

/** One bounded vanilla enchantment policy; independent of Bukkit for seeded regression checks. */
final class DungeonEnchantments {
    record Rule(String id, int max, int weight, int minimumFloor, int minimumGrade, String exclusive) { }
    private static Rule rule(String id,int max,int weight,String group){return new Rule(id,max,weight,1,0,group);}
    private static final Map<String,Rule> RULES;
    static {
        var rules=List.of(
            rule("unbreaking",3,10,""), new Rule("mending",1,1,8,1,""),
            rule("sharpness",5,8,"damage"),rule("smite",5,4,"damage"),rule("bane_of_arthropods",5,3,"damage"),
            rule("looting",3,3,""),rule("knockback",2,3,""),rule("fire_aspect",2,2,""),
            rule("efficiency",5,8,""),rule("fortune",3,3,"harvest"),rule("silk_touch",1,2,"harvest"),
            rule("protection",4,8,"protection"),rule("fire_protection",4,4,"protection"),
            rule("blast_protection",4,3,"protection"),rule("projectile_protection",4,4,"protection"),
            new Rule("thorns",3,2,6,1,""),rule("respiration",3,4,""),rule("aqua_affinity",1,3,""),
            rule("feather_falling",4,6,""),rule("depth_strider",3,3,"walking"),rule("frost_walker",2,2,"walking"),
            new Rule("soul_speed",3,1,11,1,""),new Rule("swift_sneak",3,1,11,1,""),
            rule("power",5,8,""),rule("punch",2,3,""),rule("flame",1,2,""),rule("infinity",1,2,""),
            rule("quick_charge",3,7,""),rule("piercing",4,4,"crossbow"),rule("multishot",1,3,"crossbow"),
            rule("loyalty",3,6,""),rule("impaling",5,6,""),rule("channeling",1,2,""),rule("riptide",3,3,""));
        var indexed=new LinkedHashMap<String,Rule>();for(var r:rules)indexed.put(r.id,r);RULES=Collections.unmodifiableMap(indexed);
    }
    static int grade(String tier){return switch(tier){case "common","uncommon"->0;case "rare"->1;case "legendary"->2;default->throw new IllegalArgumentException("unknown_loot_tier");};}
    static List<Rule> pool(String material){
        var names=new ArrayList<>(List.of("unbreaking","mending"));
        if(material.endsWith("_SWORD"))names.addAll(List.of("sharpness","smite","bane_of_arthropods","looting","knockback","fire_aspect"));
        else if(material.endsWith("_AXE"))names.addAll(List.of("sharpness","smite","bane_of_arthropods","efficiency","fortune","silk_touch"));
        else if(material.endsWith("_PICKAXE")||material.endsWith("_SHOVEL")||material.endsWith("_HOE"))names.addAll(List.of("efficiency","fortune","silk_touch"));
        else if(material.endsWith("_HELMET")||material.endsWith("_CHESTPLATE")||material.endsWith("_LEGGINGS")||material.endsWith("_BOOTS")){
            names.addAll(List.of("protection","fire_protection","blast_protection","projectile_protection","thorns"));
            if(material.endsWith("_HELMET"))names.addAll(List.of("respiration","aqua_affinity"));
            if(material.endsWith("_LEGGINGS"))names.add("swift_sneak");
            if(material.endsWith("_BOOTS"))names.addAll(List.of("feather_falling","depth_strider","frost_walker","soul_speed"));
        }else if(material.equals("BOW"))names.addAll(List.of("power","punch","flame","infinity"));
        else if(material.equals("CROSSBOW"))names.addAll(List.of("quick_charge","piercing","multishot"));
        else if(material.equals("TRIDENT"))names.addAll(List.of("loyalty","impaling","channeling","riptide"));
        else if(!material.equals("SHIELD"))return List.of();
        return names.stream().map(RULES::get).toList();
    }
    static boolean conflicts(String first,String second){
        if(first.equals(second))return true;
        Rule a=RULES.get(first),b=RULES.get(second);
        if(a==null||b==null)throw new IllegalArgumentException("unknown_enchantment");
        if(!a.exclusive.isEmpty()&&a.exclusive.equals(b.exclusive))return true;
        return (first.equals("infinity")&&second.equals("mending"))||(first.equals("mending")&&second.equals("infinity"))
            ||(first.equals("riptide")&&Set.of("loyalty","channeling").contains(second))
            ||(second.equals("riptide")&&Set.of("loyalty","channeling").contains(first));
    }
    static Map<String,Integer> roll(String material,int floor,int difficulty,String tier,Set<String> required,RandomGenerator random){
        if(floor<1||floor>15||difficulty<0||difficulty>2)throw new IllegalArgumentException("loot_context_out_of_range");
        int grade=grade(tier),depth=Math.min(2,(floor-1)/5),power=depth+difficulty+grade;
        var candidates=new ArrayList<>(pool(material).stream().filter(r->floor>=r.minimumFloor&&grade>=r.minimumGrade).toList());
        if(candidates.isEmpty())return Map.of();
        int count=grade==2?2:1;
        if(random.nextInt(100)<35+grade*15+depth*5+difficulty*5)count++;
        if(grade>0&&random.nextInt(100)<10+grade*10+depth*5+difficulty*5)count++;
        count=Math.min(4,Math.max(count,required.size()));
        var chosen=new LinkedHashMap<String,Integer>();
        for(String id:new TreeSet<>(required)){
            Rule r=candidates.stream().filter(x->x.id.equals(id)).findFirst().orElseThrow(()->new IllegalArgumentException("invalid_required_enchantment:"+id));
            add(chosen,r,power,grade,depth,difficulty,random);candidates.removeIf(x->conflicts(id,x.id));
        }
        while(chosen.size()<count&&!candidates.isEmpty()){
            int draw=random.nextInt(candidates.stream().mapToInt(Rule::weight).sum());Rule selected=null;
            for(var r:candidates){draw-=r.weight;if(draw<0){selected=r;break;}}
            Rule r=Objects.requireNonNull(selected);add(chosen,r,power,grade,depth,difficulty,random);candidates.removeIf(x->conflicts(r.id,x.id));
        }
        return Collections.unmodifiableMap(chosen);
    }
    private static void add(Map<String,Integer> chosen,Rule r,int power,int grade,int depth,int difficulty,RandomGenerator random){
        int cap=Math.min(r.max,2+(power>=2?1:0)+(power>=4?1:0)+(power>=6?1:0));
        int level=1+random.nextInt(cap);
        if(random.nextInt(100)<grade*15+depth*8+difficulty*8)level=Math.max(level,1+random.nextInt(cap));
        chosen.put(r.id,level);
    }
    private DungeonEnchantments(){ }
}
