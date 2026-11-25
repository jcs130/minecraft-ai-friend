package org.qiandengji.vortex;

import com.google.gson.*;
import java.util.*;
import java.util.concurrent.*;

/** Real protocol/source coordinator, external store and native IO receipts are synthetic. */
public final class LegacyTransferProtocolTest {
    static int checks;
    static void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
    static final class Store implements LegacyPointMigration.SourceStore {
        LegacyPointMigration.Source original;int prepares,confirms;boolean prepareFails,confirmFails;
        public CompletableFuture<LegacyPointMigration.Source> prepare(LegacyPointMigration.Source s){prepares++;if(prepareFails)return CompletableFuture.failedFuture(new IllegalStateException("unknown source commit"));if(original==null)original=s;return CompletableFuture.completedFuture(original);}
        public CompletableFuture<Void> confirm(LegacyPointMigration.Source s,JsonObject receipt){check(original.equals(s),"receipt belongs to frozen source");confirms++;return confirmFails?CompletableFuture.failedFuture(new IllegalStateException("unknown source acknowledgement")):CompletableFuture.completedFuture(null);}
    }
    public static void main(String[] ignored) {
        UUID actor=UUID.randomUUID();String hash="a".repeat(64),id=LegacyPointMigration.transferId(actor,hash);
        var source=new LegacyPointMigration.Source(actor,20,7,hash,id);check(source.amount()==13,"1:1 unused only");
        var spent=new LegacyPointMigration.Source(actor,1,2,hash,id);check(spent.amount()==0,"no negative credit");
        check(!id.equals(LegacyPointMigration.transferId(UUID.randomUUID(),hash)),"identity-scoped token");
        Store store=new Store();int[] calls={0};JsonObject result=LegacyPointMigration.migrate(source,store,s->{calls[0]++;return CompletableFuture.completedFuture(s.result("native_snapshot_confirmed",true,false));}).join();
        check(result.get("confirmed").getAsBoolean()&&result.get("sourceConfirmed").getAsBoolean(),"both stores confirmed");check(store.confirms==1&&calls[0]==1,"single handoff");
        Store blocked=new Store();blocked.prepareFails=true;result=LegacyPointMigration.migrate(source,blocked,s->{throw new AssertionError("target called before durable intent");}).join();check(!result.get("confirmed").getAsBoolean(),"unknown intent never grants");
        Store pending=new Store();result=LegacyPointMigration.migrate(source,pending,s->CompletableFuture.completedFuture(s.result("target_save_unknown",false,false))).join();check(pending.confirms==0&&result.get("pending").getAsBoolean(),"unknown native write never confirmed on source");
        Store malformed=new Store();result=LegacyPointMigration.migrate(source,malformed,s->{var r=s.result("confirmed",true,false);r.addProperty("amount",14);return CompletableFuture.completedFuture(r);}).join();check(malformed.confirms==0&&!result.get("confirmed").getAsBoolean(),"wrong amount cannot confirm");
        for(String key:List.of("ratio","version","sourceHash","transferId","earned","spent")) {
            Store invalid=new Store();String field=key;result=LegacyPointMigration.migrate(source,invalid,s->{var r=s.result("confirmed",true,false);r.remove(field);return CompletableFuture.completedFuture(r);}).join();check(invalid.confirms==0,"missing immutable receipt field rejected "+key);
        }
        Store sourceUnknown=new Store();sourceUnknown.confirmFails=true;result=LegacyPointMigration.migrate(source,sourceUnknown,s->CompletableFuture.completedFuture(s.result("confirmed",true,false))).join();check(result.get("confirmed").getAsBoolean()&&result.get("pending").getAsBoolean()&&!result.get("sourceConfirmed").getAsBoolean(),"target credit is distinguished from source acknowledgement");
        Store frozen=new Store();frozen.original=source;var changed=new LegacyPointMigration.Source(actor,21,7,hash,id);result=LegacyPointMigration.migrate(changed,frozen,s->{throw new AssertionError("changed source dispatched");}).join();check(result.get("status").getAsString().equals("rejected"),"source mutation does not recalculate a new credit");
        System.out.println("PASS "+checks+" legacy transfer protocol checks");
    }
}
