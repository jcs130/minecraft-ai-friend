package dev.god.godvoice;
import java.util.UUID;
import java.util.function.Function;
/** Runtime ABI regression against either the deployed or candidate JAR. */
public final class NpcVoiceApiTest {
    public static void main(String[] args)throws Exception{
        Class<?> plugin=Class.forName("dev.god.godvoice.PaperVoicePlugin");
        plugin.getMethod("npcVoiceProfiles");
        plugin.getMethod("bindHostedNpcVoice",UUID.class,UUID.class,Function.class);
        plugin.getMethod("publishNpcSpeech",UUID.class,String.class,String.class,long.class);
        plugin.getMethod("speakHostedNpc",UUID.class,UUID.class,String.class,String.class,long.class);
        plugin.getMethod("npcSpeechStatus",UUID.class,String.class);
        var original=(org.bukkit.entity.Entity)java.lang.reflect.Proxy.newProxyInstance(plugin.getClassLoader(),
            new Class<?>[]{org.bukkit.entity.Entity.class},(o,m,a)->null);
        var binding=new NpcConversations.Binding(original,text->true,100L);
        if(!binding.current(original,100L+NpcConversations.BINDING_NANOS-1))throw new AssertionError("quiet live binding");
        if(binding.current(null,101L))throw new AssertionError("stale body generation");
        if(binding.current(original,100L+NpcConversations.BINDING_NANOS))throw new AssertionError("lost heartbeat");
        System.out.println("NPC voice runtime ABI and liveness: 8 checks passed");
    }
}
