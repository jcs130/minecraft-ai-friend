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
        System.out.println("NPC voice runtime ABI and liveness: 18 checks passed");
    }
}
