package dev.qiandeng.accounts;
import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
/** Native policy contract without a game process or production files. */
public final class PolicyTest {
    static int checks;
    static void check(boolean value){if(!value)throw new AssertionError("policy contract failed #"+checks);checks++;}
    static void denied(NativePolicy policy,String reason,String name,UUID uuid,String body,UUID bodyId)throws Exception{try{policy.identity(name,uuid,body,bodyId);throw new AssertionError("unproven identity accepted");}catch(NativePolicy.Rejected failure){check(reason.equals(failure.reason));}}
    static final class Guard {
        private Path opsFile,attemptsFile;private Object eyes=null;private Set<String> reserved=Set.of("Admin","corti","goddess");private Properties attempts=new Properties();private boolean ready=true;
        Guard(Path root)throws Exception{opsFile=root.resolve("ops.json");attemptsFile=root.resolve("attempts.properties");}
        private boolean portalReserved(String name){return reserved.stream().anyMatch(x->x.equalsIgnoreCase(name))||name.toLowerCase(Locale.ROOT).endsWith("eye");}
        private synchronized long locked(String name){return Long.parseLong(attempts.getProperty(name.toLowerCase(Locale.ROOT),"0,0,0").split(",")[2]);}
    }
    public static void main(String[] args)throws Exception{
        Path root=Files.createTempDirectory("realm-policy-");UUID id=UUID.fromString("00000000-0000-3000-8000-000000000001"),other=UUID.fromString("00000000-0000-3000-8000-000000000002");Guard guard=new Guard(root);
        Files.writeString(guard.opsFile,"[{\"name\":\"Admin\",\"uuid\":\""+id+"\",\"level\":4}]");NativePolicy policy=new NativePolicy(guard);
        check(policy.identity("Admin",id,"Admin",id).equals("administrator"));
        denied(policy,"PRIVILEGED_IDENTITY_MISMATCH","Admin",id,"Alias",other);
        denied(policy,"PRIVILEGED_IDENTITY_MISMATCH","Normal",other,"Admin",id);
        denied(policy,"RESERVED_ACCOUNT","goddess",id,"goddess",id);
        denied(policy,"RESERVED_ACCOUNT","NormalEye",id,"NormalEye",id);
        check(policy.identity("Normal",other,"Alias",id).equals("player"));
        guard.attempts.setProperty("other","2,10,0");policy.wrong("Admin");policy.wrong("Admin");check(policy.retryAfter("Admin")==0);policy.wrong("Admin");check(policy.retryAfter("Admin")>590000);check(guard.attempts.getProperty("other").equals("2,10,0"));
        Properties disk=new Properties();try(var in=Files.newInputStream(guard.attemptsFile)){disk.load(in);}check(disk.equals(guard.attempts));
        JsonObject proof=new JsonObject();for(var e:Map.of("state","succeeded","operation","identity","realmId","sao","bodyName","Admin","primaryName","Admin","bodyUuid",id.toString(),"premiumUuid",other.toString()).entrySet())proof.addProperty(e.getKey(),e.getValue());proof.addProperty("totpRequired",false);proof.addProperty("observedAt",10000L);proof.addProperty("permitExpiresAt",130000L);
        check(PremiumProof.matches(proof,"Admin",id,other,11000));check(!PremiumProof.matches(proof,"Admin",id,null,11000));check(!PremiumProof.matches(proof,"Admin",id,id,11000));check(!PremiumProof.matches(proof,"Alias",id,other,11000));check(!PremiumProof.matches(proof,"Admin",other,other,11000));check(!PremiumProof.matches(proof,"Admin",id,other,130001));
        proof.addProperty("totpRequired",true);check(!PremiumProof.matches(proof,"Admin",id,other,11000));proof.addProperty("totpRequired",false);proof.addProperty("realmId","other");check(!PremiumProof.matches(proof,"Admin",id,other,11000));check(!PremiumProof.matches(new JsonObject(),"Admin",id,other,11000));
        System.out.println("{\"policyChecks\":"+checks+",\"passed\":true}");
    }
}
