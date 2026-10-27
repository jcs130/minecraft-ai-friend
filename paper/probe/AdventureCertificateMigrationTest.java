package org.afuhome.agentfriend;
import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
public final class AdventureCertificateMigrationTest {
    public static void main(String[] args)throws Exception{
        Path root=Files.createTempDirectory("qd-cert-migration-");UUID id=UUID.randomUUID();Path old=root.resolve("legacy.json");
        var source=new ProfessionLedger(old);
        if(!source.write(data->{var p=ProfessionLedger.profile(data,id);p.addProperty("combat","mage");var academy=new JsonObject();academy.addProperty("grade",7);var certs=new JsonObject();certs.add("survey_basic",new JsonObject());academy.add("certificates",certs);p.add("academy",academy);}))throw new AssertionError();
        byte[] before=Files.readAllBytes(old);var retired=new ProfessionLedger(old,true);var next=ProfessionLedger.academy(root.resolve("certificates.json"),retired);
        if(!next.ready()||next.profile(id).getAsJsonObject("academy").get("grade").getAsInt()!=7)throw new AssertionError("old grades");
        if(!next.profile(id).get("combat").getAsString().isEmpty())throw new AssertionError("retired class copied");
        if(!next.write(data->ProfessionLedger.profile(data,id).getAsJsonObject("academy").addProperty("grade",8)))throw new AssertionError("new certificate save");
        if(!Arrays.equals(before,Files.readAllBytes(old)))throw new AssertionError("retired source changed");
        var again=ProfessionLedger.academy(root.resolve("certificates.json"),retired);
        if(again.profile(id).getAsJsonObject("academy").get("grade").getAsInt()!=8)throw new AssertionError("migration replayed");
        if(retired.write(data->data.addProperty("bad",true)))throw new AssertionError("old writes allowed");
        System.out.println("7 independent certificate migration checks passed");
    }
}
