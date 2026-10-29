package dev.god.godvoice;
import java.nio.file.*;
import java.util.*;

public final class VoiceLedgerTest {
    static int checks;
    static void check(boolean value){if(!value)throw new AssertionError("check "+checks);checks++;}
    public static void main(String[] args)throws Exception{
        Path root=Files.createTempDirectory("voice-ledger-");UUID actor=UUID.randomUUID(),other=UUID.randomUUID(),request=UUID.randomUUID();
        try{
            var ledger=new VoiceLedger(root);check(ledger.reserve(actor,request,"a"));check(!ledger.reserve(actor,request,"a"));
            try{ledger.reserve(actor,request,"b");throw new AssertionError("reused identity accepted");}catch(IllegalArgumentException expected){checks++;}
            check(ledger.get(other,request)==null);check(ledger.reserve(other,request,"b"));
            ledger.transition(actor,request,"a","playing","");
            var recovered=new VoiceLedger(root);check(recovered.get(actor,request).state().equals("unknown"));check(!recovered.reserve(actor,request,"a"));
            recovered.transition(actor,request,"a","sent","");check(new VoiceLedger(root).get(actor,request).state().equals("sent"));
            UUID session=UUID.randomUUID();var sequences=new VoiceSequences();check(sequences.observe(actor,session,5));
            check(!sequences.observe(actor,session,5));check(!sequences.observe(actor,session,4));
            // A new utterance does not reset sequence history; an actual reconnect does.
            check(sequences.observe(actor,session,6));check(!sequences.observe(actor,session,5));
            check(sequences.observe(actor,UUID.randomUUID(),0));sequences.remove(actor);check(sequences.observe(actor,session,0));
            System.out.println("Voice receipts/sequences: "+checks+" checks passed");
        }finally{try(var files=Files.list(root)){for(Path file:files.toList())Files.delete(file);}Files.delete(root);}
    }
}
