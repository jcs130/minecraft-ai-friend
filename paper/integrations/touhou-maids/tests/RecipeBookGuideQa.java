package qa.recipebook;

import java.util.ArrayList;
import java.util.List;
import local.tlmcompat.numen.RecipeBookGuide;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartedEvent;

/** Test-only loader entry; never part of the production native-platform artifact. */
@Mod("recipeguideqa")
public final class RecipeBookGuideQa {
    public RecipeBookGuideQa(IEventBus ignored) {
        NeoForge.EVENT_BUS.addListener(this::started);
        NeoForge.EVENT_BUS.addListener(this::loggedIn);
    }

    private void loggedIn(PlayerEvent.PlayerLoggedInEvent event) {
        if (!(event.getEntity() instanceof ServerPlayer player)
                || !player.getGameProfile().getName().equals("QARecipe1123")) return;
        List<ItemStack> before = new ArrayList<>();
        for (int slot = 0; slot < player.getInventory().getContainerSize(); slot++)
            before.add(player.getInventory().getItem(slot).copy());
        int xp = player.totalExperience, level = player.experienceLevel;
        float progress = player.experienceProgress;
        var mode = player.gameMode.getGameModeForPlayer();
        int added = RecipeBookGuide.populate(player.getRecipeBook(), player);
        if (added != 0) throw new AssertionError("Initial recipe guide did not finish before login event");
        for (int slot = 0; slot < before.size(); slot++)
            if (!ItemStack.matches(before.get(slot), player.getInventory().getItem(slot)))
                throw new AssertionError("Recipe guide changed an existing inventory slot");
        if (xp != player.totalExperience || level != player.experienceLevel || progress != player.experienceProgress
                || mode != player.gameMode.getGameModeForPlayer())
            throw new AssertionError("Recipe guide changed experience or game mode");
        System.out.println("RECIPE_GUIDE_QA_PLAYER_STATE_PRESERVED");
    }

    private void started(ServerStartedEvent event) {
        RecipeBookGuideCheck.main(new String[0]);
        System.out.println("RECIPE_GUIDE_QA_STATE_CHECKS_PASS");
    }
}
