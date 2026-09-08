package dev.qiandeng.maid;

import com.google.gson.JsonObject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;

/** Actual durable journal; no Minecraft, chat, audio, provider or running service. */
public final class PartySpeechJournalTest {
    static int checks;
    static int symlinkChecks;
    interface Operation { void run() throws Exception; }
    static void check(boolean condition) { checks++; if (!condition) throw new AssertionError("check "+checks); }
    static void denied(Operation action) throws Exception {
        try { action.run(); throw new AssertionError("expected refusal"); }
        catch (IllegalArgumentException | java.io.IOException | BridgeProtocol.Failure expected) { checks++; }
    }
    static JsonObject input(String id) {
        var value=new JsonObject();value.addProperty("eventId",id);value.addProperty("text","Isolated hearing fixture.");return value;
    }
    static JsonObject receipt(boolean heard, String code) {
        var value=new JsonObject();value.addProperty("ok",heard);value.addProperty("heard",heard);
        value.addProperty("phase",heard?"heard":"rejected");value.addProperty("code",code);value.addProperty("observedAt",1L);return value;
    }
    public static void main(String[] args) throws Exception {
        Path temporary=Files.createTempDirectory("party-journal-contract-");
        String one="71c4a5c0-86d0-4ad3-bf03-f93f7f018001",two="71c4a5c0-86d0-4ad3-bf03-f93f7f018002";
        String fingerprint="a".repeat(64);
        try {
            Path root=temporary.resolve("journal");var journal=new PartySpeechJournal(root);
            check(journal.status(one)==null);
            check(journal.claim(one,fingerprint,input(one),receipt(false,"outcome_unknown"))==null);
            var unknown=journal.status(one);
            check(!unknown.get("heard").getAsBoolean());check(!unknown.get("ok").getAsBoolean());
            check(unknown.get("phase").getAsString().equals("unknown"));
            check(journal.claim(one,fingerprint,input(one),receipt(false,"outcome_unknown")).get("phase").getAsString().equals("unknown"));
            var restarted=new PartySpeechJournal(root);
            check(restarted.status(one).get("code").getAsString().equals("outcome_unknown"));
            denied(()->restarted.claim(one,"b".repeat(64),input(one),receipt(false,"x")));
            denied(()->restarted.finish(one,"b".repeat(64),input(one),receipt(true,"heard")));
            check(!restarted.status(one).get("heard").getAsBoolean());
            restarted.finish(one,fingerprint,input(one),receipt(true,"heard"));
            byte[] finished=Files.readAllBytes(root.resolve(one+".json"));
            check(restarted.status(one).get("heard").getAsBoolean());
            var replay=new PartySpeechJournal(root).claim(one,fingerprint,input(one),receipt(false,"x"));
            check(replay.get("heard").getAsBoolean());check(replay.get("code").getAsString().equals("heard"));
            check(java.util.Arrays.equals(finished,Files.readAllBytes(root.resolve(one+".json"))));
            denied(()->restarted.finish(one,fingerprint,input(one),receipt(false,"late_failure")));
            check(restarted.status(one).get("heard").getAsBoolean());
            // A finished out-of-range rejection must not become a later successful utterance.
            check(journal.claim(two,fingerprint,input(two),receipt(false,"outcome_unknown"))==null);
            journal.finish(two,fingerprint,input(two),receipt(false,"out_of_range"));
            var rejected=new PartySpeechJournal(root).claim(two,fingerprint,input(two),receipt(true,"heard"));
            check(!rejected.get("heard").getAsBoolean());check(rejected.get("code").getAsString().equals("out_of_range"));
            denied(()->journal.finish(two,fingerprint,input(two),receipt(true,"heard")));
            check(journal.status(two).get("code").getAsString().equals("out_of_range"));
            for(String id:new String[]{"../escape",one+"-reply","1-1-1-1-1",one.toUpperCase(),""})
                denied(()->journal.claim(id,fingerprint,input(id),receipt(false,"x")));
            try(var entries=Files.list(root)) { check(entries.count()==2); }
            Path target=temporary.resolve("outside.json");Files.writeString(target,"{}");
            try {
                Path linked=temporary.resolve("linked");Files.createSymbolicLink(linked,root);
                denied(()->new PartySpeechJournal(linked).status(one));symlinkChecks++;
                Path evil=root.resolve("71c4a5c0-86d0-4ad3-bf03-f93f7f018003.json");Files.createSymbolicLink(evil,target);
                denied(()->journal.status("71c4a5c0-86d0-4ad3-bf03-f93f7f018003"));symlinkChecks++;
                check(Files.readString(target).equals("{}"));
            } catch (UnsupportedOperationException | java.nio.file.FileSystemException unsupported) {
                // Explicitly reported as unexercised on Windows without symlink permission.
            }
        } finally {
            try(var paths=Files.walk(temporary)) {
                for(Path p:paths.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(p);
            }
        }
        System.out.println("{\"ok\":true,\"checks\":"+checks+",\"symlinkChecks\":"+symlinkChecks+",\"suite\":\"durable-party-hearing-journal\"}");
    }
}
