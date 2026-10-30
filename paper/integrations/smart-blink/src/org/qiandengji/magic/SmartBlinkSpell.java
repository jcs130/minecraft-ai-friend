// SPDX-License-Identifier: GPL-3.0-or-later
package org.qiandengji.magic;

import com.nisovin.magicspells.events.SpellTargetLocationEvent;
import com.nisovin.magicspells.events.SpellCastEvent;
import com.nisovin.magicspells.spells.TargetedLocationSpell;
import com.nisovin.magicspells.spells.TargetedSpell;
import com.nisovin.magicspells.util.CastResult;
import com.nisovin.magicspells.util.MagicConfig;
import com.nisovin.magicspells.util.SpellData;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerTeleportEvent.TeleportCause;

/** MagicSpells extension: retain native permission, cooldown, target events and post-cast charging. */
public final class SmartBlinkSpell extends TargetedSpell implements TargetedLocationSpell {
    public SmartBlinkSpell(MagicConfig config, String name) { super(config, name); }

    @Override public SpellCastEvent preCast(SpellData data) {
        SpellCastEvent event = super.preCast(data);
        // Beta15 still post-processes cancelled casts; preserve rejection without a normal success charge.
        if (event.isCancelled()) event.setSpellCastState(SpellCastState.CANCELLED);
        return event;
    }

    @Override public CastResult cast(SpellData data) {
        if (!(data.caster() instanceof Player player)) return failed(data, "player_required");
        BlinkLanding scan = new BlinkLanding(player, getRange(data));
        BlinkLanding.Selection selected = scan.select();
        if (!selected.found()) return failed(data, selected.reason());
        return move(data, selected.destination(), selected.mode());
    }

    @Override public CastResult castAtLocation(SpellData data) {
        if (!(data.caster() instanceof Player player) || !data.hasLocation()) return failed(data, "player_required");
        if (!new BlinkLanding(player, getRange(data)).accepts(data.location())) return failed(data, "unsafe_target");
        return move(data, data.location(), "aimed");
    }

    private CastResult move(SpellData data, Location destination, String mode) {
        Player player = (Player)data.caster();
        SpellTargetLocationEvent target = new SpellTargetLocationEvent(this, data, destination.clone());
        if (!target.callEvent()) return failed(data, "protected_target");
        destination = target.getTargetLocation();
        // Revalidate any location changed by another plugin; never trust an unchecked event redirect.
        if (!new BlinkLanding(player, getRange(data)).accepts(destination)) return failed(data, "unsafe_target");
        if (!player.teleport(destination, TeleportCause.PLUGIN)) return failed(data, "teleport_cancelled");
        player.setFallDistance(0);
        SpellData moved = target.getSpellData().location(destination);
        playSpellEffects(moved);
        player.sendMessage("§d[闪现] 已到" + (mode.equals("aimed") ? "瞄准落点" : "前方最远安全落点") + "。");
        // AgentFriend's existing SpellCastedEvent listener pays the selected Vortex mana exactly once.
        return new CastResult(PostCastAction.HANDLE_NORMALLY, moved);
    }

    private CastResult failed(SpellData data, String reason) {
        String message = switch (reason) {
            case "blocked_ceiling" -> "瞄准的是封闭天花板，不能穿过去；请瞄准可站立的地面。";
            case "unsafe_target" -> "瞄准落点没有安全支撑或身体空间，或路径被挡；请换一个落点。";
            case "protected_target", "teleport_cancelled" -> "传送被保护规则取消；请换一个允许进入的落点。";
            case "unloaded_path" -> "前方已加载范围内没有安全落点；先靠近并等待地形加载。";
            case "scan_limit" -> "前方地形过于复杂，安全检查已停止；请缩短目标或换方向。";
            case "player_required" -> "请使用本人在线角色施法。";
            default -> "前方范围内没有可站立的安全落点；请换方向或瞄准地面。";
        };
        if (data.caster() instanceof Player player)
            player.sendMessage("§e[blink_" + reason + "] " + message + "未传送、未耗魔、未进入冷却。查询：/mycli skills info blink");
        return new CastResult(PostCastAction.ALREADY_HANDLED, data);
    }
}
