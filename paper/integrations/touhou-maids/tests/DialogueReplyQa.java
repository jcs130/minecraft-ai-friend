import com.google.gson.*;
import java.util.*;
import java.nio.charset.StandardCharsets;

public final class DialogueReplyQa {
    public static void main(String[] args) {
        int checks=0;
        for (String status : new String[]{"pending","replied","unknown"}) {
            var bridge=new MaidDialogueReplyUnderTest();
            var actor=new Player(true);
            bridge.humanDialogue.put(actor.getUniqueId()+":near_synthetic",System.nanoTime()+60_000_000_000L);
            JsonObject data=new JsonObject();data.addProperty("status",status);
            bridge.reply(actor,"chat-result","near_synthetic",data,null);
            if(actor.humanLines!=1||actor.packets.size()!=1||!actor.systemLines.isEmpty())throw new AssertionError("Subscribed nearby dialogue must retain one human line and one structured packet");
            JsonObject envelope=JsonParser.parseString(new String(actor.packets.getFirst(),StandardCharsets.UTF_8)).getAsJsonObject();
            if(!envelope.get("action").getAsString().equals("chat-result")||!envelope.get("requestId").getAsString().equals("near_synthetic")||!envelope.get("recipientUuid").getAsString().equals(actor.getUniqueId().toString())||!envelope.getAsJsonObject("data").get("status").getAsString().equals(status))throw new AssertionError("Original action, request, recipient and status must survive");
            checks++;
        }
        var bridge=new MaidDialogueReplyUnderTest();var human=new Player(false);
        bridge.humanDialogue.put(human.getUniqueId()+":near_synthetic",System.nanoTime()+60_000_000_000L);
        bridge.reply(human,"chat-result","near_synthetic",new JsonObject(),null);
        if(human.humanLines!=1||!human.packets.isEmpty()||!human.systemLines.isEmpty())throw new AssertionError("Unsubscribed humans must not get protocol JSON");checks++;
        var machine=new Player(false);bridge.reply(machine,"receipt","query_synthetic",new JsonObject(),null);
        if(machine.humanLines!=0||!machine.packets.isEmpty()||machine.systemLines.size()!=1||!machine.systemLines.getFirst().startsWith("QD_MAID "))throw new AssertionError("Existing command fallback must remain");checks++;
        var subscriber=new Player(true);bridge.reply(subscriber,"receipt","query_synthetic",new JsonObject(),null);
        if(subscriber.humanLines!=0||subscriber.packets.size()!=1||!subscriber.systemLines.isEmpty())throw new AssertionError("Existing native receipt transport must remain");checks++;
        System.out.println("Dialogue reply transport: "+checks+" checks passed (production method).");
    }
}
final class Player {
    private final UUID id=UUID.fromString("11111111-1111-4111-8111-111111111111");
    private final boolean subscribed;
    int humanLines;
    final List<byte[]> packets=new ArrayList<>();final List<String> systemLines=new ArrayList<>();
    Player(boolean subscribed){this.subscribed=subscribed;}
    UUID getUniqueId(){return id;}
    Set<String> getListeningPluginChannels(){return subscribed?Set.of(MaidDialogueReplyUnderTest.CHANNEL):Set.of();}
    void sendPluginMessage(Object plugin,String channel,byte[] data){packets.add(data);}
    void sendMessage(String line){systemLines.add(line);}
}
final class Component { static String text(String line,Object color){return line;} }
final class NamedTextColor {static final String AQUA="aqua",RED="red";}
