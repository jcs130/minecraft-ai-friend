package org.afuhome.agentfriend;

import java.util.*;

public final class DungeonEnchantmentsTest {
    private static int checks;
    private static void require(boolean ok,String reason){checks++;if(!ok)throw new AssertionError(reason);}
    private static void atMostOne(Set<String> ids,String... group){require(Arrays.stream(group).filter(ids::contains).count()<=1,"incompatible enchantments: "+ids);}
    private static int score(Map<String,Integer> roll){return roll.values().stream().mapToInt(Integer::intValue).sum();}
    private static void rejected(Runnable action){try{action.run();throw new AssertionError("invalid context accepted");}catch(IllegalArgumentException expected){checks++;}}
    public static void main(String[] args){
        var random=new Random(918023L);var variants=new HashSet<Map<String,Integer>>();var sizes=new HashSet<Integer>();var levels=new HashSet<Integer>();
        for(int i=0;i<1000;i++){
            var roll=DungeonEnchantments.roll("IRON_SWORD",10,1,"rare",Set.of(),random);variants.add(roll);sizes.add(roll.size());levels.addAll(roll.values());
        }
        require(variants.size()>40,"same item must have varied real affixes");require(sizes.size()>1,"affix count must vary");require(levels.size()>1,"affix level must vary");
        String[] materials={"IRON_SWORD","IRON_AXE","IRON_PICKAXE","IRON_SHOVEL","IRON_HOE","IRON_HELMET","GOLDEN_CHESTPLATE","CHAINMAIL_CHESTPLATE","IRON_LEGGINGS","IRON_BOOTS","BOW","CROSSBOW","TRIDENT","SHIELD"};
        for(String material:materials)for(String tier:List.of("uncommon","rare","legendary"))for(int difficulty=0;difficulty<3;difficulty++)for(int floor=1;floor<=15;floor++)for(int i=0;i<8;i++){
            var roll=DungeonEnchantments.roll(material,floor,difficulty,tier,Set.of(),random);require(!roll.isEmpty()&&roll.size()<=4,"bounded nonempty roll");
            var legal=new HashMap<String,Integer>();for(var r:DungeonEnchantments.pool(material))legal.put(r.id(),r.max());
            for(var e:roll.entrySet())require(legal.containsKey(e.getKey())&&e.getValue()>=1&&e.getValue()<=legal.get(e.getKey()),"wrong item or vanilla level");
            var ids=roll.keySet();atMostOne(ids,"sharpness","smite","bane_of_arthropods");atMostOne(ids,"protection","fire_protection","blast_protection","projectile_protection");atMostOne(ids,"silk_touch","fortune");atMostOne(ids,"depth_strider","frost_walker");atMostOne(ids,"piercing","multishot");atMostOne(ids,"infinity","mending");atMostOne(ids,"riptide","loyalty");atMostOne(ids,"riptide","channeling");
            require(Collections.disjoint(ids,Set.of("binding_curse","vanishing_curse","sweeping_edge")),"cross-edition curated pool");
            if(floor<8||tier.equals("uncommon"))require(!ids.contains("mending"),"mending gating");
        }
        for(int i=0;i<1000;i++){
            var boots=DungeonEnchantments.roll("IRON_BOOTS",14,1,"rare",Set.of("feather_falling"),random);require(boots.containsKey("feather_falling"),"keep named falling specialty");
            var helmet=DungeonEnchantments.roll("IRON_HELMET",12,1,"rare",Set.of("respiration"),random);require(helmet.containsKey("respiration"),"keep named breathing specialty");
        }
        var a=new Random(82);var b=new Random(82);for(int i=0;i<100;i++)require(DungeonEnchantments.roll("TRIDENT",15,2,"legendary",Set.of(),a).equals(DungeonEnchantments.roll("TRIDENT",15,2,"legendary",Set.of(),b)),"seeded reproducibility");
        double low=0,high=0;for(int i=0;i<4000;i++){low+=score(DungeonEnchantments.roll("IRON_SWORD",4,0,"uncommon",Set.of(),random));high+=score(DungeonEnchantments.roll("IRON_SWORD",15,2,"legendary",Set.of(),random));}
        require(high/4000>low/4000+2,"higher floors/difficulty/rarity must improve aggregate quality");
        require(DungeonEnchantments.roll("COPPER_INGOT",1,0,"common",Set.of(),random).isEmpty(),"materials are not enchanted");
        rejected(()->DungeonEnchantments.roll("IRON_SWORD",0,0,"rare",Set.of(),random));
        rejected(()->DungeonEnchantments.roll("IRON_SWORD",16,0,"rare",Set.of(),random));
        rejected(()->DungeonEnchantments.roll("IRON_SWORD",5,-1,"rare",Set.of(),random));
        rejected(()->DungeonEnchantments.roll("IRON_SWORD",5,3,"rare",Set.of(),random));
        rejected(()->DungeonEnchantments.roll("IRON_SWORD",5,0,"unknown",Set.of(),random));
        rejected(()->DungeonEnchantments.roll("IRON_SWORD",5,0,"rare",Set.of("respiration"),random));
        System.out.println("Dungeon enchantment policy passed: "+checks+" checks; sword variants="+variants.size()+"; low/high mean="+(low/4000)+"/"+(high/4000));
    }
}
