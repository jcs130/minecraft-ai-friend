package local.tlmcompat.qa;

import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.ChatClientInfo;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.TTSCallback;
import com.github.tartaricacid.touhoulittlemaid.ai.service.tts.TTSConfig;
import com.github.tartaricacid.touhoulittlemaid.libs.javazoom.spi.mpeg.sampled.file.MpegAudioFileReader;
import com.github.tartaricacid.touhoulittlemaid.network.message.SendUserChatPackage;
import com.github.tartaricacid.touhoulittlemaid.network.message.SetMaidSoundIdPackage;
import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import local.tlmcompat.hybrid.HybridMaidPlugin;
import net.neoforged.neoforge.network.handling.ServerPayloadContext;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Installed only on the synthetic loopback fixture. Exercises the same 1.5.3 manager and TTS client as its GUI. */
public final class PackSiteQa extends JavaPlugin {
    private volatile String result = "idle";
    @Override public boolean onCommand(CommandSender sender, Command cmd, String label, String[] args) {
        if (sender instanceof Player || !Files.isRegularFile(Path.of(".test-only")) || args.length < 1) return false;
        if (args[0].equals("read")) { sender.sendMessage(result); return true; }
        var maid = HybridMaidPlugin.nativeMaid(Bukkit.getEntity(UUID.fromString(args[1])));
        if (maid == null) {sender.sendMessage("no body");return true;}
        var manager = maid.getAiChatManager();
        if (args[0].equals("setting")) {
            sender.sendMessage(!manager.customSetting.isBlank() || manager.getSetting().isPresent() ? "setting-ready" : "setting-empty");
            return true;
        }
        var owner = (CraftPlayer) Bukkit.getPlayer(maid.getOwnerUUID());
        if (owner == null) return false;
        if (args[0].equals("select")) {
            var actor = (CraftPlayer) Bukkit.getPlayerExact(args[2]);
            if (actor == null) return false;
            var packet = new SetMaidSoundIdPackage(maid.getId(), args[3]);
            SetMaidSoundIdPackage.handle(packet, new ServerPayloadContext(actor.getHandle().connection, packet.type().id()));
            sender.sendMessage("selection delivered");return true;
        }
        result = "pending";
        if (args[0].equals("chat")) {
            var packet = new SendUserChatPackage(maid.getId(),"请说一句当前天气，只回复一句中文。",
                new ChatClientInfo("zh_cn",maid.getName().getString(),List.of("安静的向导")));
            SendUserChatPackage.handle(packet,new ServerPayloadContext(owner.getHandle().connection,packet.type().id()));
        } else {
            var site = manager.getTTSSite();
            if (site == null) {sender.sendMessage("no site");return true;}
            site.client().play("这次换的是我的声音。",new TTSConfig(manager.getTTSModel(),"zh"),new TTSCallback(maid,"试听",0L) {
                @Override public void onSuccess(byte[] data) {
                    try (var in = new MpegAudioFileReader().getAudioInputStream(new ByteArrayInputStream(data))) {
                        result = "native-mp3 " + data.length + " " + in.getFormat().getSampleRate();
                    } catch (Exception e) { result = "invalid-native-audio"; }
                }
                @Override public void onFailure(java.net.http.HttpRequest r, Throwable error, int status) {result = "skipped " + status;}
            });
        }
        sender.sendMessage(result);return true;
    }
}
