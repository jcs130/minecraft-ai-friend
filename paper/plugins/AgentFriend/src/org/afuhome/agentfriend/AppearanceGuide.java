package org.afuhome.agentfriend;

import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.nio.file.Path;
import org.bukkit.Bukkit;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.persistence.PersistentDataType;
import net.skinsrestorer.api.SkinsRestorerProvider;

/** Two bounded post-login checks; storage is read away from the server thread. */
final class AppearanceGuide {
    private final AgentFriendPlugin plugin;
    private final NamespacedKey seen;
    AppearanceGuide(AgentFriendPlugin plugin) {
        this.plugin=plugin;seen=new NamespacedKey(plugin,"appearance-choice-hint-v1");
    }
    void joined(Player player) {
        for (long delay:new long[]{300L,1200L})
            Bukkit.getScheduler().runTaskLater(plugin,()->check(player),delay);
    }
    private void check(Player p) {
        if(!p.isOnline()||plugin.isObserver(p)||p.getPersistentDataContainer().has(seen,PersistentDataType.BYTE)
                ||!plugin.communication().compact(p))return;
        var uuid=p.getUniqueId();int entity=p.getEntityId();
        String file=plugin.getConfig().getString("appearance-state-file","");
        Bukkit.getScheduler().runTaskAsynchronously(plugin,()->{
            try {
                boolean skin=SkinsRestorerProvider.get().getPlayerStorage().getSkinIdOfPlayer(uuid).isPresent();
                Boolean model=null;
                if(!file.isBlank()){
                    Path path=Path.of(file);
                    if(Files.size(path)>1024*1024)return;
                    var state=JsonParser.parseString(Files.readString(path)).getAsJsonObject();
                    long age=System.currentTimeMillis()-state.get("writtenAt").getAsLong();
                    if(!"freesia_worker".equals(state.get("source").getAsString())||age< -1000||age>15000)return;
                    for(var entry:state.getAsJsonArray("players")){
                        var row=entry.getAsJsonObject();
                        if(uuid.toString().equalsIgnoreCase(row.get("playerUuid").getAsString())
                                &&row.get("entityId").getAsInt()==entity&&row.get("available").getAsBoolean()){
                            model=AppearanceHintPolicy.customModel(row.get("modelId").getAsString());break;
                        }
                    }
                }
                final Boolean selected=model;
                Bukkit.getScheduler().runTask(plugin,()->{
                    if(!p.isOnline()||p.getEntityId()!=entity)return;
                    if(!AppearanceHintPolicy.shouldSuggest(plugin.communication().compact(p),plugin.isObserver(p),
                            p.getPersistentDataContainer().has(seen,PersistentDataType.BYTE),skin,selected))return;
                    p.sendMessage("§b[外观] 你尚未设置专属外观，可按人设自行选择；皮肤画廊 /skins，设置 /skin set <皮肤名>；YSM 列表 /appearance list，设置 /appearance set <模型> <贴图>。保留默认也可以。");
                    p.getPersistentDataContainer().set(seen,PersistentDataType.BYTE,(byte)1);
                });
            } catch(Exception|LinkageError unavailable) {
                // Missing/stale evidence is unknown, never proof of a default model.
            }
        });
    }
}
