package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** One grammar for chat, --json and menus. Flags never choose a different action path. */
final class ChallengeCli {
    static final int PAGE_SIZE = 4;
    record Request(String verb, String action, List<String> values, boolean json, boolean verbose, int page) {
        boolean readOnly() { return Set.of("list", "info", "status", "result", "history").contains(action); }
        String value(int index) { return values.get(index); }
    }
    static Request parse(String[] raw) {
        var words = new ArrayList<String>();
        boolean json = false, verbose = false, pageSeen = false;
        int page = 1;
        for (int i = 1; i < raw.length; i++) {
            String word = raw[i];
            switch (word) {
                case "--json" -> json = true;
                case "--verbose" -> verbose = true;
                case "--page" -> {
                    if (pageSeen || ++i == raw.length) throw new IllegalArgumentException("--page 需要一个正整数页码");
                    try { page = Integer.parseInt(raw[i]); }
                    catch (NumberFormatException invalid) { throw new IllegalArgumentException("--page 需要一个正整数页码"); }
                    if (page < 1) throw new IllegalArgumentException("--page 需要一个正整数页码");
                    pageSeen = true;
                }
                default -> {
                    if (word.startsWith("-")) throw new IllegalArgumentException("未知选项 " + word);
                    words.add(word);
                }
            }
        }
        String verb = words.isEmpty() ? "status" : words.removeFirst().toLowerCase(Locale.ROOT);
        // 0.4.38 candidates used start <ID> to enrol and begin to run. Keep those aliases,
        // but only advertise create <ID> / start, so a bare start actually starts the timer.
        String action = verb.equals("begin") ? "start" : verb.equals("start") && words.size() == 1 ? "create" : verb;
        int count = words.size();
        boolean valid = switch (action) {
            case "list", "history", "menu", "start", "cancel" -> count == 0;
            case "create", "info" -> count == 1;
            case "join" -> count == 2;
            case "status", "result" -> count <= 1;
            default -> false;
        };
        if (!valid) throw new IllegalArgumentException("未知子命令或参数数量不符");
        if (pageSeen && !Set.of("list", "history", "result").contains(action))
            throw new IllegalArgumentException("--page 仅用于 list、history、result");
        if (verbose && !Set.of("status", "result").contains(action))
            throw new IllegalArgumentException("--verbose 仅用于 status、result");
        return new Request(verb, action, List.copyOf(words), json, verbose, page);
    }
    static int pages(int size) { return Math.max(1, (size + PAGE_SIZE - 1) / PAGE_SIZE); }
    private ChallengeCli() { }
}
