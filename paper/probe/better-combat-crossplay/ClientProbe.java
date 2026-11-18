package local.qa.combat;

import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.util.HashSet;
import java.util.Set;
import net.bettercombat.client.animation.AttackAnimationSubStack;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.player.AbstractClientPlayer;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RenderFrameEvent;
import net.neoforged.neoforge.common.NeoForge;

/** Exercises the normal client attack key and records the rendered BC layer. */
@Mod(value = "better_combat_crossplay_probe", dist = Dist.CLIENT)
public final class ClientProbe {
    private final Set<Integer> active = new HashSet<>();
    private Field attackLayer;
    private int captures;

    public ClientProbe() {
        NeoForge.EVENT_BUS.addListener(this::tick);
        NeoForge.EVENT_BUS.addListener(this::observeRender);
    }

    private boolean isolated(Minecraft game) {
        var server = game.getCurrentServer();
        return game.level != null && server != null && server.ip.startsWith("127.0.0.1:")
                && Files.isRegularFile(game.gameDirectory.toPath().resolve(".better-combat-crossplay-test"));
    }

    private void tick(ClientTickEvent.Post event) {
        var game = Minecraft.getInstance();
        if (!isolated(game) || game.screen != null) {
            return;
        }
        try {
            if (Files.deleteIfExists(game.gameDirectory.toPath().resolve("attack-once"))) {
                KeyMapping.click(game.options.keyAttack.getKey());
                System.out.println("BCQA_ATTACK_KEY");
            }
        } catch (IOException failure) {
            throw new IllegalStateException(failure);
        }
    }

    private boolean animated(AbstractClientPlayer player) {
        try {
            if (attackLayer == null) {
                attackLayer = AbstractClientPlayer.class.getDeclaredField("attackAnimation");
                attackLayer.setAccessible(true);
            }
            var layer = (AttackAnimationSubStack) attackLayer.get(player);
            return layer.base.getAnimation() != null && layer.base.getAnimation().isActive();
        } catch (ReflectiveOperationException failure) {
            throw new IllegalStateException("Better Combat QA could not inspect the live player animation", failure);
        }
    }

    private void observeRender(RenderFrameEvent.Post event) {
        var game = Minecraft.getInstance();
        if (!isolated(game)) {
            active.clear();
            return;
        }
        var now = new HashSet<Integer>();
        for (var player : game.level.players()) {
            if (!animated(player)) {
                continue;
            }
            int id = player.getId();
            now.add(id);
            if (!active.contains(id) && captures < 24) {
                String filename = "bc-" + player.getName().getString() + "-" + ++captures + ".png";
                Screenshot.grab(game.gameDirectory, filename, game.getMainRenderTarget(),
                        result -> System.out.println("BCQA_RENDER " + id + " " + filename));
            }
        }
        active.retainAll(now);
        active.addAll(now);
    }
}
