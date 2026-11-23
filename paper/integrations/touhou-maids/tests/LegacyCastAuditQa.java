package local.tlmcompat.hybrid;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * Audited closure of a LEGACY companion cast whose swallowed exception left no provable outcome.
 * Unlike an external resident cast, the legacy path has no service ledger: mana is deducted at the
 * top of NativeMaidMagicSupport.cast before effects apply, and an exception after that point leaves
 * consumed mana and possibly partial effects with no record. This tool therefore never claims
 * "no effects" and never replays the spell; it settles the original request as an unproven failure
 * so the host stops freezing, and keeps the audit note inside the durable receipt.
 *
 * Fixture self-test (no production files):
 *   java local.tlmcompat.hybrid.LegacyCastAuditQa <tempDir>
 * Operator settlement during a reviewed maintenance window (original body receipt directory):
 *   java local.tlmcompat.hybrid.LegacyCastAuditQa --settle <receiptDir> <maidId> <ownerId> <requestId> <auditNoteFile>
 * The operator must first verify the maid is NOT an external resident (those reconcile through the
 * bridge receipt query) and attach the evidence inventory to the maintenance record.
 */
public final class LegacyCastAuditQa {
    private static int checks;
    private static void check(boolean condition,String title){if(!condition)throw new AssertionError(title);checks++;}
    static JsonObject settle(MaidBodyControl control,UUID maid,String request,String note,JsonObject evidence)throws Exception {
        var row=control.read(maid,request);
        if(row==null)throw new IllegalArgumentException("receipt_missing_query_original_namespace");
        if(!"cast".equals(row.get("action").getAsString())||!"unknown".equals(row.get("status").getAsString()))
            throw new IllegalArgumentException("only_an_unknown_legacy_cast_may_be_audited");
        if(note==null||note.strip().length()<8||note.length()>300||note.codePoints().anyMatch(Character::isISOControl))
            throw new IllegalArgumentException("inspection_note_required");
        var observation=new JsonObject();
        observation.addProperty("reason","legacy_cast_exception_outcome_unproven");
        observation.addProperty("outcomeUnproven",true);
        observation.addProperty("effectsVerified",false);
        observation.addProperty("auditNote",note.strip());
        observation.addProperty("auditedAt",java.time.Instant.now().toString());
        if(evidence!=null)observation.add("evidence",evidence.deepCopy());
        return control.finish(maid,request,"failed",observation);
    }
    public static void main(String[] args)throws Exception {
        if(args.length==6&&args[0].equals("--settle")){
            var dir=Path.of(args[1]);UUID maid=UUID.fromString(args[2]),owner=UUID.fromString(args[3]);
            var note=Files.readString(Path.of(args[5]),StandardCharsets.UTF_8);
            var control=new MaidBodyControl(dir,Map.of(maid,owner));
            var settled=settle(control,maid,args[4],note,null);
            var file=dir.resolve(maid.toString()).resolve(args[4]+".json");
            System.out.println("settled "+args[4]+" status="+settled.get("status").getAsString()
                    +" terminal="+settled.get("terminal").getAsBoolean()
                    +" sha256="+java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file))));
            return;
        }
        Path root=Path.of(args[0]);UUID maid=UUID.randomUUID(),owner=UUID.randomUUID();
        var control=new MaidBodyControl(root,Map.of(maid,owner));
        var cast=JsonParser.parseString("{\"action\":\"cast\",\"requestId\":\"hs_legacy1\",\"spellId\":\"astral_convergence\"}").getAsJsonObject();
        control.reserve(owner,maid,"hs_legacy1",cast);
        var uncertain=new JsonObject();uncertain.addProperty("reason","execution_uncertain_query_original_request");
        control.finish(maid,"hs_legacy1","unknown",uncertain);
        var evidence=new JsonObject();evidence.addProperty("ownerOnlineAtIncident",true);evidence.addProperty("serviceLedger","none_legacy_path");
        var settled=settle(control,maid,"hs_legacy1"," combat heal interrupted; mana map lost on restart; outcome unproven ",evidence);
        check(settled.get("status").getAsString().equals("failed")&&settled.get("terminal").getAsBoolean(),"unproven legacy cast closes as a terminal failure");
        check(!settled.get("goalCompleted").getAsBoolean()&&!settled.get("retryAllowed").getAsBoolean(),"no success claim and no replay permission");
        var observation=settled.getAsJsonObject("observation");
        check(observation.get("outcomeUnproven").getAsBoolean()&&!observation.get("effectsVerified").getAsBoolean(),"closure never claims verified effects");
        check(!observation.has("effectsApplied"),"absence of effects is not provable on the legacy path");
        check(observation.get("auditNote").getAsString().equals("combat heal interrupted; mana map lost on restart; outcome unproven"),"audit note is preserved verbatim");
        check(observation.getAsJsonObject("evidence").get("ownerOnlineAtIncident").getAsBoolean(),"evidence inventory stays with the receipt");
        var restarted=new MaidBodyControl(root,Map.of(maid,owner));
        check(restarted.read(maid,"hs_legacy1").get("status").getAsString().equals("failed"),"restart keeps the audited closure");
        check(restarted.reserve(owner,maid,"hs_legacy1",cast).get("terminal").getAsBoolean(),"duplicate original request never reopens the spell");
        try{settle(control,maid,"hs_legacy1","another note for the same request",null);throw new AssertionError("second settlement allowed");}
        catch(IllegalArgumentException e){check(e.getMessage().equals("only_an_unknown_legacy_cast_may_be_audited"),"already terminal receipt refuses a second audit");}
        var cast2=JsonParser.parseString("{\"action\":\"cast\",\"requestId\":\"hs_legacy2\",\"spellId\":\"astral_convergence\"}").getAsJsonObject();
        control.reserve(owner,maid,"hs_legacy2",cast2);control.finish(maid,"hs_legacy2","unknown",uncertain);
        try{settle(control,maid,"hs_legacy2","short",null);throw new AssertionError("short note allowed");}
        catch(IllegalArgumentException e){check(e.getMessage().equals("inspection_note_required"),"a real inspection note is required");}
        check(control.read(maid,"hs_legacy2").get("status").getAsString().equals("unknown"),"a refused audit leaves the original receipt untouched");
        var walk=JsonParser.parseString("{\"action\":\"walk\",\"requestId\":\"hs_walk1\",\"x\":1,\"y\":64,\"z\":2}").getAsJsonObject();
        control.reserve(owner,maid,"hs_walk1",walk);control.finish(maid,"hs_walk1","unknown",uncertain);
        try{settle(control,maid,"hs_walk1","this is a walk, not a cast",null);throw new AssertionError("non-cast settled");}
        catch(IllegalArgumentException e){check(e.getMessage().equals("only_an_unknown_legacy_cast_may_be_audited"),"only cast receipts use this closure");}
        System.out.println("Legacy cast audited closure: "+checks+" checks passed");
    }
}