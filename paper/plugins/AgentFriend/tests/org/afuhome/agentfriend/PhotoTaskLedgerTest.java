package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;

public final class PhotoTaskLedgerTest {
    static int checks;
    static void check(boolean value,String label){if(!value)throw new AssertionError(label);checks++;}
    public static void main(String[] args)throws Exception {
        Path root=Files.createTempDirectory("photo-task-ledger-");
        UUID owner=UUID.randomUUID(),other=UUID.randomUUID(),job=UUID.randomUUID();
        PhotoRequest request=new PhotoRequest("旅途","third",1,"洞口看到了发光的植物");
        Path file=root.resolve("photo-tasks.json");
        var ledger=new PhotoTaskLedger(file);
        check(ledger.begin(owner,job,request,100),"first request saved");
        check(!ledger.begin(owner,UUID.randomUUID(),request,101),"same owner cannot submit twice");
        check(ledger.latest(other)==null,"private per-owner lookup");
        JsonObject snapshot=ledger.latest(owner);snapshot.addProperty("status","success");
        check(ledger.unresolved(owner),"caller cannot mutate saved receipt");
        var restart=new PhotoTaskLedger(file);
        check(restart.latest(owner).get("status").getAsString().equals("stopped"),"queued task stops without replay on restart");
        check(restart.begin(owner,job,request,200),"known unstarted task can be replaced");
        JsonObject fields=new JsonObject();fields.addProperty("startedAt",201);
        check(restart.update(owner,job,"rendering",fields),"save before dispatch");
        restart=new PhotoTaskLedger(file);
        check(restart.latest(owner).get("status").getAsString().equals("unknown"),"in-flight task never becomes idle/success after restart");
        check(restart.lastStarted(owner)==201,"cooldown survives restart");
        check(!restart.begin(owner,UUID.randomUUID(),request,300),"unknown does not trigger new capture");
        check(!restart.update(other,job,"success",null),"another owner cannot complete");
        check(!restart.update(owner,UUID.randomUUID(),"success",null),"stale job cannot complete");
        check(restart.latest(owner).get("story").getAsString().equals(request.story()),"story survives restart");
        check(restart.update(owner,job,"success",null),"confirmed delivery can resolve original job");
        check(!restart.update(owner,job,"unknown",null),"late failure cannot undo delivery");
        check(restart.latest(owner).get("status").getAsString().equals("success"),"completion remains queryable");
        check(restart.begin(owner,UUID.randomUUID(),request,400),"next voluntary request after completion");
        check(restart.lastStarted(owner)==201,"new queue cannot reset cooldown");
        String saved=Files.readString(file);
        Files.createDirectory(file.resolveSibling("photo-tasks.json.tmp"));
        check(!restart.update(owner,UUID.fromString(restart.latest(owner).get("job").getAsString()),"rendering",fields),"disk error prevents dispatch receipt");
        check(Files.readString(file).equals(saved),"failed write preserves previous data");
        Path corrupt=root.resolve("corrupt.json");Files.writeString(corrupt,"{bad json");
        check(!new PhotoTaskLedger(corrupt).ready(),"malformed ledger fails closed without overwrite");
        check(Files.readString(corrupt).equals("{bad json"),"corrupt source preserved");
        Path invalid=root.resolve("invalid-task.json");
        JsonObject broken=JsonParser.parseString(saved).getAsJsonObject();
        broken.getAsJsonObject("players").getAsJsonObject(owner.toString()).getAsJsonObject("photoTask").remove("status");
        Files.writeString(invalid,broken.toString());var invalidLedger=new PhotoTaskLedger(invalid);
        check(!invalidLedger.ready()&&invalidLedger.latest(owner)==null,"invalid task fields make status safely unavailable");
        check(!invalidLedger.begin(owner,UUID.randomUUID(),request,500),"invalid receipt never permits another capture");
        check(Files.readString(invalid).equals(broken.toString()),"invalid receipt retained for review");
        System.out.println("photo-task-ledger-checks="+checks+" passed=true");
    }
}
