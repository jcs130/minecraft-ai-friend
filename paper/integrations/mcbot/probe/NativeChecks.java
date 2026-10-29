package org.qiandengji.mcbot.qa;

import com.dwinovo.numen.api.entity.NumenPlayer;
import com.dwinovo.numen.api.permission.PlacedBlocks;
import com.dwinovo.numen.api.task.CompanionTickDispatcher;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.Blocks;
import org.bukkit.Bukkit;
import org.bukkit.command.*;
import org.bukkit.craftbukkit.CraftServer;
import org.bukkit.plugin.java.JavaPlugin;
import java.nio.file.*;
import java.util.UUID;

/** Disposable loopback QA only; never part of the production adapter JAR. */
public final class NativeChecks extends JavaPlugin {
    @Override public void onEnable(){
        try {if(Bukkit.getPort()!=25928||!Bukkit.getIp().equals("127.0.0.1")||!Files.readString(Path.of(".qa-only")).equals("VORTEX_TAKEOVER_QA_ONLY"))throw new IllegalStateException("QA-only");}
        catch(Exception bad){throw new IllegalStateException("Not a marked loopback QA server",bad);}
        getServer().getCommandMap().register("qa",new Command("mcbot-native-check"){
            @Override public boolean execute(CommandSender sender,String label,String[] args){
                if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return true;
                try {
                    var server=((CraftServer)Bukkit.getServer()).getServer();
                    var body=NumenPlayer.findByUuid(server,UUID.fromString(args[0]));if(body==null)throw new IllegalArgumentException("body");
                    if(args.length==2&&args[1].equals("idle")){
                        var task=CompanionTickDispatcher.currentTaskFor(body.getUUID());if(task!=null&&!task.getState().isTerminal())throw new IllegalStateException("native task still active");
                        sender.sendMessage("PASS native task stopped");return true;
                    }
                    BlockPos pos=new BlockPos(Integer.parseInt(args[1]),Integer.parseInt(args[2]),Integer.parseInt(args[3]));
                    if(body.blockPosition().distSqr(pos)>256)throw new IllegalArgumentException("range");
                    var level=body.serverLevel();var placed=PlacedBlocks.of(level);var state=level.getBlockState(pos);
                    var before=placed.placerAt(pos,state);if(before==null||!before.id().equals(body.getUUID()))throw new IllegalStateException("self provenance missing");
                    if(placed.placerAt(pos,Blocks.AIR.defaultBlockState())!=null)throw new IllegalStateException("snapshot air visible");
                    if(!before.equals(placed.placerAt(pos,state)))throw new IllegalStateException("stale snapshot erased live provenance");
                    BlockPos air=pos.above(4);if(!level.getBlockState(air).isAir())throw new IllegalStateException("fixture air");
                    int size=placed.size();placed.record(air,before);placed.placerAt(air,Blocks.AIR.defaultBlockState());
                    if(placed.size()!=size)throw new IllegalStateException("live air did not clear stale mark");
                    sender.sendMessage("PASS snapshot preserves ownership; live air cleans metadata");
                }catch(Exception bad){sender.sendMessage("FAIL "+bad.getMessage());}return true;
            }
        });
    }
}
