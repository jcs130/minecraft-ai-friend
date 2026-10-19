package org.afuhome.numen;

import com.google.gson.JsonObject;
import java.util.UUID;

/** Exercises secret separation and stale/replayed response rejection. */
public final class FormsTest {
    private static int checks;
    private static void check(boolean value) { checks++; if(!value) throw new AssertionError("case " + checks); }
    private static void refuse(String name,String service,String model,String protocol,String url,String key) {
        try { new ModelDraft(new JsonObject(),name,service,model,protocol,url,key); throw new AssertionError("accepted invalid form"); }
        catch(IllegalArgumentException e) { check(!e.toString().contains("PRIVATE_TEST_KEY")); }
    }
    public static void main(String[] args) {
        JsonObject old = new JsonObject(); old.addProperty("max_tokens",4321); old.addProperty("id","my:old");
        ModelDraft draft = new ModelDraft(old,"personal","openai","test-model","chat","https://example.invalid/v1","PRIVATE_TEST_KEY");
        check(draft.fields.get("max_tokens").getAsInt()==4321);
        check(!draft.fields.toString().contains("PRIVATE_TEST_KEY"));
        check(!draft.toString().contains("PRIVATE_TEST_KEY"));
        check(draft.key.equals("PRIVATE_TEST_KEY"));
        check(draft.fields.get("group").getAsString().equals("mine"));
        check(old.size()==2);
        ModelDraft blank = new ModelDraft(old,"personal","openai","test-model","chat","","");
        check(blank.key.isEmpty() && !blank.fields.has("base_url"));
        refuse("../x","openai","m","chat","","PRIVATE_TEST_KEY");
        refuse("x","../openai","m","chat","","PRIVATE_TEST_KEY");
        refuse("x","openai","","chat","","PRIVATE_TEST_KEY");
        refuse("x","openai","m","unknown","","PRIVATE_TEST_KEY");
        refuse("x","openai","m","chat","file:///tmp/key","PRIVATE_TEST_KEY");
        refuse("x","openai","m","chat","example.invalid/v1","PRIVATE_TEST_KEY");
        refuse("x","openai","m","chat","https://user:PRIVATE_TEST_KEY@example.invalid","PRIVATE_TEST_KEY");
        refuse("x","openai","m","chat","https://example.invalid?key=PRIVATE_TEST_KEY","PRIVATE_TEST_KEY");
        refuse("x","openai","m","chat","https://[PRIVATE_TEST_KEY","PRIVATE_TEST_KEY");
        refuse("x","openai","m","chat","","PRIVATE_TEST_KEY\nmore");
        FormTickets tickets = new FormTickets(); UUID owner=UUID.randomUUID(),other=UUID.randomUUID();
        UUID first = tickets.issue(owner,1000); check(!tickets.take(other,first,1001));
        check(tickets.take(owner,first,1001)); check(!tickets.take(owner,first,1002));
        UUID stale=tickets.issue(owner,1000); UUID latest=tickets.issue(owner,1001);
        check(!tickets.take(owner,stale,1002)); check(tickets.take(owner,latest,1002));
        UUID expired=tickets.issue(owner,1000); check(!tickets.take(owner,expired,301001));
        UUID closed=tickets.issue(owner,1000); tickets.close(owner); check(!tickets.take(owner,closed,1001));
        UUID disabled=tickets.issue(owner,1000); tickets.clear(); check(!tickets.take(owner,disabled,1001));
        System.out.println("Numen Bedrock form boundaries: " + checks + " cases passed");
    }
}
