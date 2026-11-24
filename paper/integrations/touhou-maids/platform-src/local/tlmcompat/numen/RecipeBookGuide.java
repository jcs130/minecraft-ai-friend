package local.tlmcompat.numen;

import java.util.Collection;

import net.minecraft.network.ConnectionProtocol;
import net.minecraft.network.protocol.game.ClientboundUpdateRecipesPacket;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.stats.ServerRecipeBook;
import net.minecraft.world.item.crafting.RecipeHolder;
import net.neoforged.neoforge.network.registration.NetworkRegistry;

public final class RecipeBookGuide {
    private static final ResourceLocation MAID_MODEL_CHANNEL =
            ResourceLocation.fromNamespaceAndPath("touhou_little_maid", "maid_model");

    private RecipeBookGuide() {
    }

    public static int populate(ServerRecipeBook book, ServerPlayer player) {
        Collection<RecipeHolder<?>> recipes = player.server.getRecipeManager().getRecipes();
        if (!NetworkRegistry.hasChannel(player.connection.connection, ConnectionProtocol.PLAY,
                MAID_MODEL_CHANNEL)) {
            recipes = NativeClientRecipes.project(new ClientboundUpdateRecipesPacket(recipes),
                    player.server.registryAccess()).getRecipes();
        }

        return addMissing(book, recipes);
    }

    public static int addMissing(ServerRecipeBook book, Collection<RecipeHolder<?>> recipes) {
        int added = 0;
        for (RecipeHolder<?> recipe : recipes) {
            if (!book.contains(recipe)) {
                // RecipeBook.add changes only known recipes, without unlock criteria or packets.
                book.add(recipe);
                if (book.contains(recipe)) {
                    added++;
                }
            }
        }
        return added;
    }
}
