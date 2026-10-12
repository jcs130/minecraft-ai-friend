package dev.qiandeng.maw;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;

/** Runs the compiled parser, including invalid and ambiguous chants. No MC runtime. */
public final class SystemCallSyntaxCheck {
    private static int assertions;
    private static void check(boolean ok) { assertions++; if (!ok) throw new AssertionError("system_call_check_" + assertions); }
    private static void rejected(Runnable task) {
        boolean rejected = false;
        try { task.run(); } catch (IllegalArgumentException expected) { rejected = true; }
        check(rejected);
    }
    public static void main(String[] args) throws Exception {
        JsonObject source = JsonParser.parseString(Files.readString(Path.of(args[0]))).getAsJsonObject();
        var parser = new SystemCallSyntax(source);
        Set<String> skills = JsonParser.parseString(Files.readString(Path.of(args[1]))).getAsJsonObject().getAsJsonObject("skills").keySet();
        check(parser.formulas().size() == 10);
        for (var f : parser.formulas()) {
            check(skills.contains(f.skillId()));
            check(parser.parse(f.id()).equals(f));
            check(parser.parse(f.chant()).equals(f));
            check(parser.parse("  " + f.chant().toUpperCase(Locale.ROOT).replace(". ", " .   ") + " ").equals(f));
            check(parser.parse(f.chant().substring(0, f.chant().length()-1)).equals(f));
            check(parser.skillId(f.id()).equals(f.skillId()));
            check(parser.forSkill(f.skillId()).equals(f));
            rejected(() -> parser.parse(f.chant()+"."));
            rejected(() -> parser.parse(f.chant()+" Discharge."));
            rejected(() -> parser.parse(f.chant().replace("System Call.", "")));
        }
        for (String bad : List.of("", " ", "/op someone", "System Call. op someone", "vital_mend\n/op someone", "vital_mend;op", "vital_mend|op", "天命", "a".repeat(513))) rejected(() -> parser.parse(bad));
        rejected(() -> parser.parse(null));
        check(parser.skillId("starbolt").equals("starbolt"));
        JsonObject duplicate = source.deepCopy(); duplicate.getAsJsonArray("formulas").add(duplicate.getAsJsonArray("formulas").get(0).deepCopy());
        rejected(() -> new SystemCallSyntax(duplicate));
        System.out.println("{\"ok\":true,\"assertions\":"+assertions+"}");
    }
}
