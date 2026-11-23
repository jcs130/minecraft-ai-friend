package dev.god.godvoice;
import java.lang.reflect.Proxy;
import java.util.UUID;
import java.util.function.Function;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
/** Runtime ABI regression against either the deployed or candidate JAR. */
public final class NpcVoiceApiTest {
    private static void check(boolean allowed) {
        if (!allowed) throw new AssertionError("private dialogue policy");
    }

    public interface MessagingUser {
        boolean isIgnoreMsg();
    }

    public record TestUser(boolean isMuted, boolean isIgnoreMsg, MessagingUser ignored) implements MessagingUser {
        public boolean isIgnoredPlayer(MessagingUser sender) { return sender == ignored; }
    }

    public record TestEssentials(Player speaker, TestUser sender, Player recipient, TestUser receiver) {
        public MessagingUser getUser(Player player) {
            if (player == speaker) return sender;
            return player == recipient ? receiver : null;
        }
    }

    private static Player player(boolean online, boolean canSee) {
        return (Player) Proxy.newProxyInstance(NpcDialoguePolicyTest.class.getClassLoader(), new Class<?>[]{Player.class},
            (source, method, args) -> switch (method.getName()) {
                case "isOnline" -> online;
                case "canSee" -> {
                    check(method.getParameterTypes()[0] == Player.class);
                    yield canSee;
                }
                default -> throw new AssertionError(method.getName());
            });
    }

    private static void privateDialogueChecks() throws ReflectiveOperationException {
        var speaker = player(true, true);
        var recipient = player(true, true);
        var inaccessible = player(true, false);
        var offline = player(false, true);
        var maid = (Entity) Proxy.newProxyInstance(NpcDialoguePolicyTest.class.getClassLoader(), new Class<?>[]{Entity.class},
            (source, method, args) -> { throw new AssertionError(method.getName()); });
        check(NpcConversations.privateMessageAllowed(speaker, recipient, null));
        check(!NpcConversations.privateMessageAllowed(inaccessible, recipient, null));
        check(!NpcConversations.privateMessageAllowed(offline, recipient, null));
        check(NpcConversations.privateMessageAllowed(inaccessible, maid, null));

        var talking = new TestUser(false, false, null);
        var muted = new TestUser(true, false, null);
        var ignoringDms = new TestUser(false, true, null);
        var ignoringSpeaker = new TestUser(false, false, talking);
        check(NpcConversations.essentialsPrivateMessageAllowed(new TestEssentials(speaker, talking, recipient, talking),
            MessagingUser.class, speaker, recipient));
        check(!NpcConversations.essentialsPrivateMessageAllowed(new TestEssentials(speaker, muted, recipient, talking),
            MessagingUser.class, speaker, recipient));
        check(!NpcConversations.essentialsPrivateMessageAllowed(new TestEssentials(speaker, talking, recipient, ignoringDms),
            MessagingUser.class, speaker, recipient));
        check(!NpcConversations.essentialsPrivateMessageAllowed(new TestEssentials(speaker, talking, recipient, ignoringSpeaker),
            MessagingUser.class, speaker, recipient));
        check(!NpcConversations.essentialsPrivateMessageAllowed(new TestEssentials(speaker, talking, recipient, null),
            MessagingUser.class, speaker, recipient));
        check(!NpcConversations.essentialsPrivateMessageAllowed(new TestEssentials(speaker, null, recipient, talking),
            MessagingUser.class, speaker, recipient));
        check(NpcConversations.essentialsPrivateMessageAllowed(new TestEssentials(speaker, talking, recipient, null),
            MessagingUser.class, speaker, null));
        check(!NpcConversations.essentialsPrivateMessageAllowed(new TestEssentials(speaker, muted, recipient, null),
            MessagingUser.class, speaker, null));
    }

    public static void main(String[] args)throws Exception{
        privateDialogueChecks();
        Class<?> plugin=Class.forName("dev.god.godvoice.PaperVoicePlugin");
        plugin.getMethod("npcVoiceProfiles");
        plugin.getMethod("bindHostedNpcVoice",UUID.class,UUID.class,Function.class);
        if (plugin.getMethod("queueHostedPrivateConversation",UUID.class,UUID.class,String.class).getReturnType() != String.class)
            throw new AssertionError("hosted private conversation receipt ABI");
        if (plugin.getMethod("queueNpcPrivateConversation",UUID.class,UUID.class,String.class).getReturnType() != String.class)
            throw new AssertionError("maid private conversation receipt ABI");
        plugin.getMethod("publishNpcSpeech",UUID.class,String.class,String.class,long.class);
        plugin.getMethod("speakHostedNpc",UUID.class,UUID.class,String.class,String.class,long.class);
        plugin.getMethod("npcSpeechStatus",UUID.class,String.class);
        plugin.getMethod("bindVillagerNpcVoice",org.bukkit.plugin.Plugin.class,UUID.class,Function.class);
        plugin.getMethod("speakVillagerReply",org.bukkit.plugin.Plugin.class,UUID.class,UUID.class,String.class,String.class);
        plugin.getMethod("finishVillagerPrivateReply",org.bukkit.plugin.Plugin.class,UUID.class,UUID.class,String.class,String.class);
        var original=(org.bukkit.entity.Entity)java.lang.reflect.Proxy.newProxyInstance(plugin.getClassLoader(),
            new Class<?>[]{org.bukkit.entity.Entity.class},(o,m,a)->null);
        var binding=new NpcConversations.Binding(original,text->true,100L);
        if(!binding.current(original,100L+NpcConversations.BINDING_NANOS-1))throw new AssertionError("quiet live binding");
        if(binding.current(null,101L))throw new AssertionError("stale body generation");
        if(binding.current(original,100L+NpcConversations.BINDING_NANOS))throw new AssertionError("lost heartbeat");
        var speaker=(org.bukkit.entity.Player)java.lang.reflect.Proxy.newProxyInstance(plugin.getClassLoader(),
            new Class<?>[]{org.bukkit.entity.Player.class},(o,m,a)->null);
        var world=UUID.randomUUID();
        var turn=new NpcConversations.VillagerTurn(original,speaker,world,binding.generation(),1000,false);
        if(!turn.current(original,speaker,world,binding.generation(),1000))throw new AssertionError("valid original turn");
        if(turn.current(original,speaker,world,UUID.randomUUID(),999))throw new AssertionError("rebind cannot inherit old dialogue");
        if(turn.current(original,null,world,binding.generation(),999))throw new AssertionError("listener disconnected");
        if(turn.current(original,speaker,UUID.randomUUID(),binding.generation(),999))throw new AssertionError("dimension changed");
        if(turn.current(original,speaker,world,binding.generation(),1001))throw new AssertionError("reply expired");
        var privateTurn=new NpcConversations.VillagerTurn(original,speaker,world,binding.generation(),1000,true);
        var rejoined=(org.bukkit.entity.Player)java.lang.reflect.Proxy.newProxyInstance(plugin.getClassLoader(),
            new Class<?>[]{org.bukkit.entity.Player.class},(o,m,a)->null);
        if(!privateTurn.direct() || !privateTurn.current(original,speaker,world,binding.generation(),995))
            throw new AssertionError("private turn with original listener");
        if(privateTurn.current(original,rejoined,world,binding.generation(),995))throw new AssertionError("reconnected listener");
        System.out.println("NPC voice runtime ABI, liveness and private dialogue: 34 checks passed");
    }
}
