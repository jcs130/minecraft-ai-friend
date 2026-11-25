package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;

public final class LegacyPointSourcePolicyTest {
    static int checks;
    static void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
    static JsonObject profile(int earned,int spent) {
        JsonObject p=new JsonObject(),points=new JsonObject();points.addProperty("earned",earned);points.addProperty("spent",spent);
        points.addProperty("levelHighWater",12);p.add("points",points);p.addProperty("level",9);p.addProperty("skill","old_skill_preserved");return p;
    }
    public static void main(String[] ignored) {
        UUID a=UUID.randomUUID(),b=UUID.randomUUID();JsonObject players=new JsonObject();players.add(a.toString(),profile(20,7));players.add(b.toString(),profile(4,8));JsonObject before=players.deepCopy();
        JsonObject frozen=LegacyPointTransfers.freeze(players,1234),rows=frozen.getAsJsonObject("records");
        check(players.equals(before),"source points/levels/history unchanged by roster freeze");
        JsonObject row=rows.getAsJsonObject(a.toString());check(row.get("amount").getAsInt()==13,"1:1 unspent only");
        check(rows.getAsJsonObject(b.toString()).get("amount").getAsInt()==0,"overspent never negative credit");
        check(row.get("transferId").getAsString().equals(LegacyPointTransfers.transferId(a,row.get("sourceHash").getAsString())),"stable actor/hash ID");
        check(!LegacyPointTransfers.transferId(a,row.get("sourceHash").getAsString()).equals(LegacyPointTransfers.transferId(b,row.get("sourceHash").getAsString())),"cross actor cannot share ID");
        players.add(UUID.randomUUID().toString(),profile(6,0));check(frozen.getAsJsonObject("records").size()==2,"new default profile is not old money");
        JsonObject confirmation=row.deepCopy();confirmation.addProperty("confirmed",true);confirmation.addProperty("version",LegacyPointTransfers.VERSION);confirmation.addProperty("ratio","1:1");
        check(LegacyPointTransfers.confirmation(row,confirmation),"native confirmed receipt accepted");
        JsonObject bad=confirmation.deepCopy();bad.addProperty("confirmed",false);bad.addProperty("nativeBalance",13);check(!LegacyPointTransfers.confirmation(row,bad),"matching balance is not receipt confirmation");
        for(String key:List.of("earned","spent","amount","sourceHash","transferId","version","ratio")) {
            bad=confirmation.deepCopy();bad.remove(key);check(!LegacyPointTransfers.confirmation(row,bad),"missing receipt field rejected "+key);
        }
        bad=confirmation.deepCopy();bad.addProperty("transferId",LegacyPointTransfers.transferId(b,row.get("sourceHash").getAsString()));check(!LegacyPointTransfers.confirmation(row,bad),"wrong transfer receipt rejected");
        JsonObject invalidPlayers=new JsonObject();JsonObject negative=profile(-1,0);invalidPlayers.add(a.toString(),negative);
        check(LegacyPointTransfers.freeze(invalidPlayers,1).getAsJsonObject("records").getAsJsonObject(a.toString()).get("state").getAsString().equals("rejected"),"negative legacy value preserved but not credited");
        JsonObject fractional=profile(1,0);fractional.getAsJsonObject("points").addProperty("earned",1.5);invalidPlayers.add(a.toString(),fractional);
        check(LegacyPointTransfers.freeze(invalidPlayers,1).getAsJsonObject("records").getAsJsonObject(a.toString()).get("state").getAsString().equals("rejected"),"fractional values not silently rounded");
        JsonObject max=profile(Integer.MAX_VALUE,0);invalidPlayers.add(a.toString(),max);check(LegacyPointTransfers.freeze(invalidPlayers,1).getAsJsonObject("records").getAsJsonObject(a.toString()).get("amount").getAsInt()==Integer.MAX_VALUE,"boundary amount retains exact value");
        try {
            var folder=java.nio.file.Files.createTempDirectory("legacy-source-policy-");var originalFile=folder.resolve("source.json");var transferFile=folder.resolve("transfers.json");
            var writable=new ProfessionLedger(originalFile);check(writable.write(root->{root.getAsJsonObject("players").add(a.toString(),ProfessionLedger.empty());var p=root.getAsJsonObject("players").getAsJsonObject(a.toString());p.getAsJsonObject("points").addProperty("earned",20);p.getAsJsonObject("points").addProperty("spent",7);}),"synthetic source saved");
            String sourceBytes=java.nio.file.Files.readString(originalFile);var readOnly=new ProfessionLedger(originalFile,true);var journal=new ProfessionLedger(transferFile);
            check(!readOnly.write(root->root.addProperty("illegal",true)),"old source is really read-only");check(LegacyPointTransfers.freezeSource(readOnly,journal),"durable intent works with read-only original ledger");
            check(java.nio.file.Files.readString(originalFile).equals(sourceBytes),"freeze does not alter any source bytes");
            String saved=java.nio.file.Files.readString(transferFile);check(LegacyPointTransfers.freezeSource(readOnly,journal)&&java.nio.file.Files.readString(transferFile).equals(saved),"roster freeze is persisted once, not recalculated");
            check(new ProfessionLedger(transferFile).data().getAsJsonObject(LegacyPointTransfers.ROOT).getAsJsonObject("records").getAsJsonObject(a.toString()).get("amount").getAsInt()==13,"original unused amount survives cold journal read");
            java.nio.file.Files.delete(transferFile);java.nio.file.Files.delete(originalFile);java.nio.file.Files.delete(folder);
        } catch(java.io.IOException failure){throw new AssertionError(failure);}
        System.out.println("PASS "+checks+" legacy source freeze/confirmation checks");
    }
}
