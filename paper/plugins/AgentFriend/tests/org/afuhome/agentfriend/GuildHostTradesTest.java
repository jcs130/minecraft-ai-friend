package org.afuhome.agentfriend;

import java.lang.reflect.Proxy;
import java.util.*;
import org.bukkit.entity.Villager;
import org.bukkit.inventory.MerchantRecipe;

public final class GuildHostTradesTest {
    private static int checks;
    public static int passedChecks() { return checks; }
    private static void check(boolean condition) { checks++; if (!condition) throw new AssertionError("check " + checks); }
    private static void ensure(Villager host) {
        try {
            var loader = org.bukkit.Bukkit.getPluginManager().getPlugin("AgentFriend").getClass().getClassLoader();
            var method = Class.forName("org.afuhome.agentfriend.GuildHostTrades", true, loader).getDeclaredMethod("ensure", Villager.class);
            method.setAccessible(true); method.invoke(null, host);
        } catch (java.lang.reflect.InvocationTargetException wrapped) {
            if (wrapped.getCause() instanceof RuntimeException error) throw error;
            throw new AssertionError(wrapped.getCause());
        } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
    }
    private static final class Host {
        int level, observed, additions, mutations;
        boolean fail;
        final Villager.Profession profession;
        List<MerchantRecipe> offers;
        Host(Villager.Profession profession, int level, boolean existing) {
            this.profession = profession; this.level = level;
            offers = existing ? Collections.singletonList(null) : List.of();
        }
        Villager villager() {
            return (Villager) Proxy.newProxyInstance(Villager.class.getClassLoader(), new Class<?>[]{Villager.class}, (p,m,a) -> switch(m.getName()) {
                case "getVillagerLevel" -> level;
                case "getProfession" -> profession;
                case "setVillagerLevel" -> { mutations++; level = (Integer)a[0]; yield null; }
                case "getRecipes" -> { observed = level; if (fail) throw new IllegalStateException("fixture lookup failure"); yield offers; }
                case "addTrades" -> { check(level == 1 || profession != Villager.Profession.CARTOGRAPHER); additions += (Integer)a[0]; yield true; }
                default -> throw new AssertionError("Unexpected mutation or query: " + m.getName());
            });
        }
    }
    public static void main(String[] args) {
        checks = 0;
        Host fresh = new Host(Villager.Profession.CARTOGRAPHER, 2, false);
        ensure(fresh.villager());
        check(fresh.observed == 1); check(fresh.level == 2); check(fresh.additions == 2);
        Host existing = new Host(Villager.Profession.CARTOGRAPHER, 5, true);
        var offers = existing.offers;
        for (int i=0;i<3;i++) ensure(existing.villager());
        check(existing.observed == 1); check(existing.level == 5);
        check(existing.offers == offers); check(existing.additions == 0);
        Host failed = new Host(Villager.Profession.CARTOGRAPHER, 3, false); failed.fail = true;
        try { ensure(failed.villager()); throw new AssertionError("Expected failure"); }
        catch (IllegalStateException expected) { check(failed.level == 3); check(failed.additions == 0); }
        Host other = new Host(Villager.Profession.LIBRARIAN, 4, true);
        ensure(other.villager());
        check(other.level == 4); check(other.observed == 4); check(other.mutations == 0);
        Host novice = new Host(Villager.Profession.CARTOGRAPHER, 1, true);
        ensure(novice.villager());
        check(novice.level == 1); check(novice.mutations == 0);
        System.out.println("GuildHostTradesTest: " + checks + " passed");
    }
}
