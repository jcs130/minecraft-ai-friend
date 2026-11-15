package org.afuhome.agentfriend;

import java.util.HashSet;
import java.util.Set;

/** Player-facing discovery checks; no account or quest progress is changed. */
public final class AdventureChoiceTest {
    private static int checks;
    private static void check(boolean value, String label) {
        checks++;
        if (!value) throw new AssertionError(label);
    }
    public static void main(String[] args) {
        var commands = new HashSet<String>();
        int cursor = 0;
        for (int n = 0; n < 6; n++) {
            var result = GuildAdventureGuide.next(cursor, true, true, true, true, id -> true);
            commands.add(result.hint().command());
            cursor = result.nextIndex();
        }
        check(commands.contains("/mycli arena status"), "village trial is discoverable in the activity rotation");
        check(commands.contains("/mycli dungeon list"), "Aincrad and site expeditions remain separate from the practice tower");
        check(commands.size() == 6 && cursor == 0, "each of six routes appears once before repeating");
        for (int start : new int[]{0, 1, 2, 3, 4, 5, -1, Integer.MIN_VALUE, Integer.MAX_VALUE}) {
            var hints = new HashSet<String>();
            cursor = start;
            for (int n = 0; n < 3; n++) {
                var result = GuildAdventureGuide.next(cursor, true, true, true, true, true,
                        id -> { throw new AssertionError("occupied quest slot must not query replacement offers"); });
                hints.add(result.hint().command());
                check(result.hint().message().contains("不必放弃或重接"), "active progress is explicitly retained");
                cursor = result.nextIndex();
            }
            check(hints.equals(Set.of("/mycli dungeon list", "/mycli arena status",
                    "/mycli photo take <新照片名> third 1 --story <见闻>")), "active contract can discover only independent activities");
        }
        var limited = GuildAdventureGuide.next(0, false, false, false, false, true, id -> true);
        check(limited.hint().command().equals("/mycli arena status"), "unavailable camera and sites are skipped without suggesting a conflicting quest");
        check(limited.hint().message().contains("从第一层开始"), "restart rule is visible");
        check(limited.hint().message().contains("艾恩葛朗特"), "village practice and Aincrad are explicitly distinguished");
        System.out.println("AdventureChoiceTest passed " + checks + " checks");
    }
}
