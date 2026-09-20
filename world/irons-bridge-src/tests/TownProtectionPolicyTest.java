package dev.qiandeng.irons;

/** Pure policy boundary/exception tests, no Minecraft world or service startup. */
public final class TownProtectionPolicyTest {
    private static int checks;
    private static void check(boolean value) {
        checks++;
        if (!value) throw new AssertionError("town protection check " + checks);
    }
    public static void main(String[] args) {
        String world = "minecraft:overworld";
        for (int x : new int[]{-715,-714,-544,-376,-375}) {
            for (int z : new int[]{695,696,865,1034,1035}) {
                check(TownProtectionPolicy.contains(world,x,z));
            }
        }
        for (int x : new int[]{Integer.MIN_VALUE,-716,-374,Integer.MAX_VALUE})
            check(!TownProtectionPolicy.contains(world,x,865));
        for (int z : new int[]{Integer.MIN_VALUE,694,1036,Integer.MAX_VALUE})
            check(!TownProtectionPolicy.contains(world,-544,z));
        check(!TownProtectionPolicy.contains("minecraft:the_nether",-544,865));
        check(!TownProtectionPolicy.contains("minecraft:the_end",-544,865));
        check(TownProtectionPolicy.contains(null,-544,865));
        check(TownProtectionPolicy.near(world,-729,865,14));
        check(!TownProtectionPolicy.near(world,-730,865,14));
        for (String crop : new String[]{"minecraft:wheat","minecraft:carrots","minecraft:potatoes","minecraft:beetroots"}) {
            int age=crop.endsWith("beetroots") ? 3 : 7;
            check(TownProtectionPolicy.matureFieldCrop(crop,age,age,true));
            check(!TownProtectionPolicy.matureFieldCrop(crop,age-1,age,true));
            check(!TownProtectionPolicy.matureFieldCrop(crop,age,age,false));
            check(!TownProtectionPolicy.matureFieldCrop(crop,age+1,age,true));
            check(TownProtectionPolicy.mayPlant(crop,true,true));
            check(!TownProtectionPolicy.mayPlant(crop,false,true));
            check(!TownProtectionPolicy.mayPlant(crop,true,false));
        }
        // Farm-like building materials, trees and decorative grass never become dig exceptions.
        for (String structure : new String[]{"minecraft:hay_block","minecraft:oak_leaves","minecraft:grass_block",
                "minecraft:dirt","minecraft:farmland","minecraft:oak_log","minecraft:bamboo","minecraft:chest"}) {
            check(!TownProtectionPolicy.matureFieldCrop(structure,7,7,true));
            check(!TownProtectionPolicy.mayPlant(structure,true,true));
        }
        check(!TownProtectionPolicy.matureFieldCrop("minecraft:wheat",0,0,true));
        System.out.println("{\"ok\":true,\"suite\":\"town_protection_policy\",\"checks\":"+checks+"}");
    }
}
