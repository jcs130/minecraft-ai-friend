package org.qiandengji.mcbot;

import com.google.gson.*;
import com.dwinovo.numen.api.brain.ClientDriverBook;
import com.dwinovo.numen.api.brain.ConnectionCalls;
import java.util.*;
import java.util.concurrent.atomic.*;
import java.nio.file.*;

public final class BoundaryTest {
    private static int checks;
    private static void check(boolean ok){if(!ok)throw new AssertionError("check "+checks);checks++;}
    private static void rejects(Runnable action){try{action.run();throw new AssertionError("accepted malformed request");}catch(IllegalArgumentException expected){checks++;}}
    public static void main(String[] args)throws Exception{
        JsonObject o=Wire.envelope("tool_call");o.addProperty("seq",7);o.addProperty("tool","status");o.add("args",new JsonObject());
        o.addProperty("text","中文🎮\\\"{}");check(Wire.decode(Wire.encode(o)).equals(o));
        byte[] bytes=Wire.encode(o);rejects(()->Wire.decode(Arrays.copyOf(bytes,bytes.length-1)));
        rejects(()->Wire.decode(Arrays.copyOf(bytes,bytes.length+1)));
        rejects(()->Wire.decode(new byte[]{(byte)0x80}));rejects(()->Wire.decode(new byte[]{-1,-1,-1,0}));
        rejects(()->Wire.decode(new byte[]{2,(byte)0xc3,0x28}));
        o.addProperty("text","测".repeat(12000));rejects(()->Wire.encode(o));
        JsonObject numeric=new JsonObject();numeric.addProperty("x",1.5);rejects(()->Wire.integer(numeric,"x",-10,10));
        numeric.addProperty("x","1");rejects(()->Wire.integer(numeric,"x",-10,10));
        numeric.addProperty("x",2);check(Wire.integer(numeric,"x",-10,10)==2);
        numeric.addProperty("flag","false");rejects(()->Wire.bool(numeric,"flag",false));
        JsonObject deep=Wire.envelope("tool_call"),cursor=deep;for(int i=0;i<33;i++){var next=new JsonObject();cursor.add("nested",next);cursor=next;}
        rejects(()->Wire.decode(Wire.encode(deep)));
        var receipts=new Receipts(3,4);var first=new Receipts.Key(1,1);
        check(receipts.begin(first,"dig")==Receipts.State.NEW);
        check(receipts.begin(first,"dig")==Receipts.State.RUNNING);
        check(receipts.begin(first,"place")==Receipts.State.CONFLICT);
        receipts.finish(first,new byte[]{1,2});check(receipts.begin(first,"dig")==Receipts.State.COMPLETE);
        byte[] copy=receipts.response(first);copy[0]=9;check(receipts.response(first)[0]==1);
        var second=new Receipts.Key(1,2);receipts.begin(second,"move");receipts.finish(second,new byte[4]);
        check(receipts.begin(second,"move")==Receipts.State.UNKNOWN);
        var third=new Receipts.Key(2,1);check(receipts.begin(third,"dig")==Receipts.State.NEW);
        receipts.interrupt(2);check(receipts.begin(third,"dig")==Receipts.State.UNKNOWN);
        check(receipts.begin(new Receipts.Key(3,1),"dig")==Receipts.State.FULL);
        var book=new ClientDriverBook(1);UUID owner=UUID.randomUUID(),body=UUID.randomUUID();Object connection=new Object();
        AtomicBoolean live=new AtomicBoolean(true);AtomicInteger closed=new AtomicInteger();
        var lease=book.acquire(owner,body,connection,live::get,closed::incrementAndGet);check(lease!=null&&lease.current());
        check(book.acquire(owner,body,connection,live::get,()->{})==lease);
        check(book.acquire(owner,body,new Object(),()->true,()->{})==null);
        check(book.acquire(UUID.randomUUID(),body,connection,()->true,()->{})==null);
        check(book.acquire(owner,UUID.randomUUID(),connection,()->true,()->{})==null);
        live.set(false);check(!lease.current()&&closed.get()==1);lease.close();check(closed.get()==1);
        var next=book.acquire(owner,body,new Object(),()->true,closed::incrementAndGet);check(next!=null);
        lease.close();check(next.current());book.closeAll();check(!next.current()&&closed.get()==2);
        var reentrant=new ClientDriverBook(2);AtomicBoolean valid=new AtomicBoolean(true);AtomicReference<ClientDriverBook.Lease> inner=new AtomicReference<>();
        reentrant.acquire(owner,body,connection,valid::get,()->inner.set(reentrant.acquire(owner,body,new Object(),()->true,()->{})));
        valid.set(false);check(reentrant.acquire(owner,body,new Object(),()->true,()->{})==null);check(inner.get().current());reentrant.closeAll();
        String program=ConnectionCalls.PREFIX+UUID.randomUUID(),call=program+"#1";
        AtomicBoolean callLive=new AtomicBoolean(true);AtomicInteger cancelled=new AtomicInteger();
        var scope=ConnectionCalls.open(body,program,callLive::get);
        check(ConnectionCalls.allows(body,call));check(!ConnectionCalls.allows(UUID.randomUUID(),call));
        check(ConnectionCalls.watch(body,call,cancelled::incrementAndGet));
        check(ConnectionCalls.allows(body,"resident-call#1")&&!ConnectionCalls.transientCall("resident-call#1"));
        callLive.set(false);check(!ConnectionCalls.allows(body,call));check(!ConnectionCalls.watch(body,call,()->{}));
        scope.close();scope.close();check(cancelled.get()==1&&!ConnectionCalls.allows(body,call));
        check(ConnectionCalls.transientCall(call));
        String other=ConnectionCalls.PREFIX+UUID.randomUUID();var otherScope=ConnectionCalls.open(body,other,()->true);
        scope.close();check(ConnectionCalls.allows(body,other+"#1"));otherScope.close();
        var tasks=new Tasks();check(tasks.begin(1,true,false,null));check(!tasks.begin(1,true,false,1L));
        rejects(()->tasks.begin(1,false,false,1L));rejects(()->tasks.begin(1,true,false,null));rejects(()->tasks.begin(2,true,false,1L));check(tasks.begin(2,false,true,null));
        check(Policy.command("/mycli status").equals("mycli status"));check(Policy.command("mycli skills learn shield_bash").contains("shield_bash"));
        check(Policy.bodyName("ag_Example").equals("ag_Example"));rejects(()->Policy.bodyName("GODDESS"));rejects(()->Policy.bodyName("CortiCam"));rejects(()->Policy.bodyName("ag_CorMy_eye"));rejects(()->Policy.bodyName("too_long_minecraft_name"));
        rejects(()->Policy.command("op Other"));rejects(()->Policy.command("mycli admin give"));rejects(()->Policy.command("mycli status\nlogin secret"));rejects(()->Policy.command("mycli cast x;op"));
        JsonObject query=new JsonObject();query.addProperty("query",true);check(Policy.readOnly("craft",query));query.addProperty("query",false);check(!Policy.readOnly("craft",query));check(!Policy.readOnly("equip",new JsonObject()));
        Path dir=Files.createTempDirectory("mcbot-binding-test-");
        try{
            Path path=dir.resolve("bindings.json");var bindings=new Bindings(path);check(bindings.get(owner)==null);
            bindings.put(owner,new Bindings.Binding(body,"StoredBody",false));check(new Bindings(path).get(owner).body().equals(body));
            bindings.put(owner,new Bindings.Binding(body,"StoredBody",true));check(new Bindings(path).get(owner).paused());
            Files.writeString(path,"{corrupt");try{new Bindings(path);throw new AssertionError("corruption accepted");}catch(RuntimeException expected){checks++;}
            Path blocker=dir.resolve("not-a-folder");Files.writeString(blocker,"x");var blocked=new Bindings(blocker.resolve("bindings.json"));
            try{blocked.put(owner,new Bindings.Binding(body,"StoredBody",false));throw new AssertionError("write should fail");}catch(java.io.IOException expected){check(blocked.get(owner)==null);}
            Files.delete(path);Files.delete(blocker);
        }finally{Files.delete(dir);}
        System.out.println("mcbot independent boundary checks passed: "+checks);
    }
}
