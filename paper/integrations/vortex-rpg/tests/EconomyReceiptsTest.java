package org.qiandengji.vortex;
import java.nio.file.*;
import java.util.*;
public final class EconomyReceiptsTest {
    public static void main(String[]args)throws Exception{
        Path root=Files.createTempDirectory("qd-gold-receipts");UUID owner=UUID.randomUUID();
        EconomyReceipts r=new EconomyReceipts(root);
        assert !r.pending(owner);assert !r.completed(owner,"trial:a:1");
        var t=r.begin(owner,"trial:a:1",List.of("STATE:trial","GOLD:5"));
        assert r.pending(owner);t.committed();t.issuing(0);t.applied(0);t.issuing(1);
        // Reconstructing after a process interruption keeps ISSUING unknown.
        assert new EconomyReceipts(root).pending(owner);
        try{r.begin(owner,"shop:b",List.of());throw new AssertionError("pending did not block");}catch(java.io.IOException expected){}
        t.applied(1);r.finish(owner,t);assert !r.pending(owner);assert r.completed(owner,"trial:a:1");
        assert !new EconomyReceipts(root).pending(owner);assert new EconomyReceipts(root).completed(owner,"trial:a:1");
        var second=r.begin(owner,"shop:b",List.of("GOODS:iron_sword"));assert r.pending(owner);
        assert !r.pending(UUID.randomUUID());
        // Query cost is bounded by a single index and ticket, not by all completed sales.
        Files.writeString(root.resolve(owner.toString()).resolve("irrelevant.properties"),"malformed old history");
        assert r.pending(owner);
        System.out.println("economy-receipts=11");
    }
}
