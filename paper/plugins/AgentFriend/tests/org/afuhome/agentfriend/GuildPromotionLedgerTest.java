package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Exercises the same grade boundary as a small-division confirmation and an exam submission. */
public final class GuildPromotionLedgerTest {
    private static final UUID PLAYER=UUID.fromString("c0400000-0000-4000-8000-000000000001");
    private static int checks;

    private static void check(boolean ok,String message){
        if(!ok)throw new AssertionError(message);
        checks++;
    }
    private static JsonObject academy(JsonObject root){
        return ProfessionLedger.profile(root,PLAYER).getAsJsonObject("academy");
    }
    private static boolean promote(ProfessionLedger ledger,int from,int to){
        return ledger.write(root->SkillAssessments.advanceGrade(academy(root),from,to));
    }
    public static void main(String[] args) throws Exception {
        var small=new AssessmentCatalog.Grade(13,180,List.of(List.of("original_cert")),List.of("original_topic"),"old exam");
        var smallJson=AssessmentCatalog.JSON.toJsonTree(SkillAssessments.displayedGrade(small)).getAsJsonObject();
        check(smallJson.keySet().equals(Set.of("index","fame","prerequisites","fresh","description")),"small divisions retain legacy JSON keys");
        check(smallJson.get("index").getAsInt()==13&&smallJson.get("fame").getAsInt()==small.fame(),"minor rank uses its configured fame threshold");
        check(smallJson.getAsJsonArray("prerequisites").size()==small.prerequisites().size()&&smallJson.getAsJsonArray("fresh").size()==small.fresh().size(),"configured certificate conditions and optional practical topics are retained");
        check(smallJson.get("description").getAsString().equals(small.description())&&small.fresh().equals(List.of("original_topic")),"original definition retained; no independent point target invented");
        var major=new AssessmentCatalog.Grade(12,160,small.prerequisites(),small.fresh(),"major practical");
        check(SkillAssessments.displayedGrade(major).equals(major),"major ranks retain exact existing requirements and field types");
        Path dir=Files.createTempDirectory("guild-promotion-");
        Path file=dir.resolve("academy.json"),temp=dir.resolve("academy.json.tmp");
        try {
            ProfessionLedger ledger=new ProfessionLedger(file);
            check(ledger.write(root->{
                JsonObject a=new JsonObject(),certs=new JsonObject();
                certs.addProperty("native_clear","existing run");a.add("certificates",certs);
                ProfessionLedger.profile(root,PLAYER).add("academy",a);
            }),"create synthetic pre-migration profile");
            String before=Files.readString(file);
            check(!promote(ledger,3,5)&&Files.readString(file).equals(before),"cannot skip a division on initial migration");
            Files.createDirectory(temp);
            check(!promote(ledger,3,4),"failed durable write is reported");
            check(Files.readString(file).equals(before)&&!academy(ledger.data()).has("rankPointsStarted"),"failed write preserves grade and migration credit");
            Files.delete(temp);
            check(promote(ledger,3,4),"one transition from a legacy major rank");
            JsonObject recovered=academy(new ProfessionLedger(file).data());
            check(recovered.get("grade").getAsInt()==4&&recovered.get("rankPointsStarted").getAsBoolean()&&recovered.get("progressionPolicy").getAsString().equals("fame_v1"),"grade and retired-scoring tombstone survive reopening with the fame-only policy");
            check(recovered.getAsJsonObject("certificates").size()==1&&recovered.getAsJsonObject("certificates").has("native_clear"),"existing certificate retained without issuing a new one");
            String after=Files.readString(file);
            check(!promote(ledger,3,4)&&Files.readString(file).equals(after),"stale request cannot grant another step");
            check(!promote(ledger,5,6)&&Files.readString(file).equals(after),"an exam for the wrong source grade cannot commit");
            check(promote(ledger,4,5)&&promote(ledger,5,6),"later verified transitions advance one grade at a time");
            check(!promote(ledger,6,18),"reject out-of-range grade");
            System.out.println("GuildPromotionLedgerTest: "+checks+" passed");
        }finally{
            Files.deleteIfExists(temp);Files.deleteIfExists(file);Files.deleteIfExists(dir);
        }
    }
}
