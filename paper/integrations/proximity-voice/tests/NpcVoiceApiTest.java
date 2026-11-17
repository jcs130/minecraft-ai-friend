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
        System.out.println("NPC voice runtime ABI: 5 checks passed");
    }
}
