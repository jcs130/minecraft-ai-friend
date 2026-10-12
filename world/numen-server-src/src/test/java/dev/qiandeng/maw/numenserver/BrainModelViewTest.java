package dev.qiandeng.maw.numenserver;

import com.google.gson.*;
import com.dwinovo.numen.agent.llm.*;
import com.dwinovo.numen.agent.loop.ModelRequest;
import com.dwinovo.numen.core.tools.Clicks;
import com.dwinovo.numen.core.tools.GuiOps;
import com.dwinovo.numen.sdk.Codec;
import com.dwinovo.numen.sdk.LuaCodecs;
import java.util.List;
import java.util.Optional;
import java.nio.file.*;
import java.io.IOException;

/** Real JSON/Numen classpath test; no server, model, or world actions. */
public final class BrainModelViewTest {
    static int checks;
    static void check(boolean value,String message) {
        if(!value)throw new AssertionError(message);checks++;
    }
    public static void main(String[] args) throws Exception {
        check(HeadlessBrain.goalLimit(new JsonObject())==24,"Keep the production goal budget default");
        check(HeadlessBrain.goalLimit(JsonParser.parseString("{\"modelCallsPerGoal\":48}").getAsJsonObject())==48,"Allow an explicitly configured finite longer goal");
        for(String invalid:List.of("101","0","1.5","\"48\"")) {
            try {HeadlessBrain.goalLimit(JsonParser.parseString("{\"modelCallsPerGoal\":"+invalid+"}").getAsJsonObject());throw new AssertionError("Invalid budget must be refused");}
            catch(IllegalArgumentException expected){check(true,"Refuse invalid goal budget");}
        }
        JsonObject raw=JsonParser.parseString("""
            {"bodyId":"body","sampledAt":"now","position":{"x":1,"y":2,"z":3},
             "inventory":[{"slot":0,"empty":true},{"slot":36,"empty":false,"id":"minecraft:iron_sword","count":1,"componentsSnbt":"exact full components"}],
             "menu":{"containerId":4,"slotCount":63,"cursor":{"empty":true},"slots":[{"slot":0,"empty":true},{"slot":26,"empty":false,"count":2,"componentsSnbt":"chest components"}]},
             "nativeState":{"menu":{"duplicated":true,"menuType":"farmersdelight:cooking_pot","stateId":8,"selectedHotbarSlot":2,"slotRoles":{"7":"serving_container"}},"self":{"mana":{"current":55,"max":100},"equipment":{"mainhand":{"snbt":"exact weapon"}},"motion":{"large":true},"ysm":{"large":true}}},
             "currentAction":{"action_id":"one","phase":"accepted","before":{"recursive":true}}}
            """).getAsJsonObject();
        String original=raw.toString();JsonObject view=HeadlessBrain.modelView(raw);
        check(raw.toString().equals(original),"Must not modify original SDK/ledger state");
        check(view.get("bodyId").equals(raw.get("bodyId")),"Keep body identity");
        check(view.get("position").equals(raw.get("position")),"Keep absolute coordinates");
        check(view.getAsJsonArray("inventory").size()==1,"Omit only empty inventory cells");
        JsonObject item=view.getAsJsonArray("inventory").get(0).getAsJsonObject();
        check(item.get("slot").getAsInt()==36,"Keep actual slot number, never renumber");
        check(item.get("componentsSnbt").getAsString().equals("exact full components"),"Keep complete item components");
        JsonObject menu=view.getAsJsonObject("menu");
        check(menu.get("slotCount").getAsInt()==63&&menu.get("containerId").getAsInt()==4,"Keep container identity and capacity");
        check(menu.getAsJsonArray("slots").size()==1&&menu.getAsJsonArray("slots").get(0).getAsJsonObject().get("slot").getAsInt()==26,"Preserve container slot indexes");
        check(menu.get("cursor").equals(raw.getAsJsonObject("menu").get("cursor")),"Keep cursor state");
        check(menu.get("menuType").getAsString().equals("farmersdelight:cooking_pot")&&menu.get("stateId").getAsInt()==8,"Keep actual menu type and CAS version");
        check(menu.get("selectedHotbarSlot").getAsInt()==2&&menu.has("slotRoles"),"Keep hand selection and native slot role information");
        check(!view.has("nativeState"),"Omit duplicate native menu and inventory");
        check(view.getAsJsonObject("self").getAsJsonObject("mana").get("current").getAsInt()==55,"Keep real mana");
        check(view.getAsJsonObject("self").getAsJsonObject("equipment").getAsJsonObject("mainhand").get("snbt").getAsString().equals("exact weapon"),"Keep equipment components");
        check(!view.getAsJsonObject("self").has("motion")&&!view.getAsJsonObject("self").has("ysm"),"No animation history in decision context");
        check(!view.getAsJsonObject("currentAction").has("before"),"Do not recursively expand active-action history");
        JsonObject receipt=new JsonObject();receipt.add("before",raw.deepCopy());receipt.add("after",raw.deepCopy());
        receipt.getAsJsonObject("before").getAsJsonObject("menu").addProperty("containerId",0);
        receipt.addProperty("phase","terminal");receipt.addProperty("ok",false);
        receipt.add("outcome",JsonParser.parseString("{\"status\":\"error\",\"error_kind\":\"out_of_reach\"}"));
        String fullReceipt=receipt.toString();JsonObject compact=HeadlessBrain.modelView(receipt);
        check(receipt.toString().equals(fullReceipt)&&receipt.has("before"),"Full durable receipt remains intact");
        check(!compact.has("before")&&!compact.getAsJsonObject("after").has("nativeState"),"Compact nested action receipt");
        check(compact.get("outcome").equals(receipt.get("outcome"))&&!compact.get("ok").getAsBoolean(),"Never turn failure into success or drop failure reason");
        check(compact.getAsJsonObject("observedEffects").get("menuChanged").getAsBoolean()&&compact.getAsJsonObject("observedEffects").get("openContainerId").getAsInt()==4,"Expose menu changes even if another part of the script failed");
        JsonObject profile=JsonParser.parseString("{\"provider\":\"openai\",\"apiKey\":\"fixture-not-a-key\",\"model\":\"qwen3.7-plus\",\"baseUrl\":\"https://coding.dashscope.aliyuncs.com/v1\"}").getAsJsonObject();
        HeadlessBrain.Prepared prepared=HeadlessBrain.prepare(profile,new ModelRequest(List.of(new ConvoState.Msg.User("hello")),List.of(),"system"));
        check(prepared.request().uri().toString().equals("https://coding.dashscope.aliyuncs.com/v1/chat/completions"),"Prepare real provider wire request without sending");
        check(prepared.bytes()>0&&prepared.request().bodyPublisher().orElseThrow().contentLength()==prepared.bytes(),"Record exact UTF-8 payload bytes");
        try {
            HeadlessBrain.prepare(profile,new ModelRequest(List.of(new ConvoState.Msg.User("x".repeat(524289))),List.of(),"system"));
            throw new AssertionError("Oversized context must be refused before dispatch");
        }catch(HeadlessBrain.ModelFailure failure) {
            check(failure.code.equals("model_context_limit_request_not_sent")&&!failure.unknown,"Local preflight refusal is known, not an uncertain paid request");
        }
        @SuppressWarnings("unchecked")
        Codec<Object> declared=(Codec<Object>)(Codec<?>)LuaCodecs.of(Clicks.Clicked.class,"Clicked");
        GuiOps.Window opened=new GuiOps.Window("minecraft:generic_9x3",List.of(),Optional.empty(),List.of(),Optional.empty());
        try {
            declared.encode(opened);
            throw new AssertionError("Pinned item-use codec must reproduce the original menu-return crash");
        }catch(IllegalArgumentException failure) {check(true,"Reproduce the actual Numen 0.1.4.1 record mismatch");}
        Codec<Object> corrected=NativeReturnContracts.correct("numen","use","item",declared);
        check(corrected.encode(opened).toString().contains("minecraft:generic_9x3"),"Item use can return an actual opened menu");
        Clicks.Clicked clicked=new Clicks.Clicked(Clicks.Button.RIGHT,Optional.empty(),Optional.empty(),List.of("item consumed"));
        check(corrected.encode(clicked).toString().contains("item consumed"),"Preserve normal item-use changes");
        check(NativeReturnContracts.types(corrected).stream().anyMatch(c->c.name().endsWith("Window")&&c.fields().stream().anyMatch(f->f.name().equals("slots"))),"Discovery includes the actual menu-return fields");
        check(NativeReturnContracts.correct("numen","use","block",declared)==declared,"Other function contracts remain unchanged");
        Path directory=Files.createTempDirectory("numen-publish-test-");
        try {
            Path old=directory.resolve("state.json"),tmp=directory.resolve("ready.tmp");
            Files.writeString(old,"original unknown action");Files.writeString(tmp,"new fully flushed payload");
            int[] attempts={0};
            PrivateStore.publish(tmp,old,(from,to)->{
                check(Files.readString(from).equals("new fully flushed payload"),"Retry the same complete payload");
                if(attempts[0]++<2)throw new AccessDeniedException(to.toString());
                Files.move(from,to,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
            },true);
            check(attempts[0]==3&&Files.readString(old).equals("new fully flushed payload"),"Transient Windows reader conflict publishes exactly once");
            Files.writeString(tmp,"must not overwrite original");attempts[0]=0;
            try {
                PrivateStore.publish(tmp,old,(from,to)->{attempts[0]++;throw new AccessDeniedException(to.toString());},true);
                throw new AssertionError("Persistent access failure must be reported");
            }catch(AccessDeniedException expected) {
                check(attempts[0]==6&&Files.readString(old).equals("new fully flushed payload"),"Bound retries and preserve previous durable state");
            }
            attempts[0]=0;
            try {
                PrivateStore.publish(tmp,old,(from,to)->{attempts[0]++;throw new IOException("fixture disk failure");},true);
                throw new AssertionError("Non-sharing failures must not retry");
            }catch(IOException expected) {check(attempts[0]==1,"Do not retry generic storage failures");}
        }finally {
            try(var files=Files.list(directory)){for(Path file:files.toList())Files.delete(file);}
            Files.delete(directory);
        }
        System.out.println("{\"ok\":true,\"checks\":"+checks+",\"modelRequests\":0,\"worldActions\":0}");
    }
}
