package org.cortico.minecraft;

import java.util.regex.Pattern;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.message.v1.ClientReceiveMessageEvents;

/** Filters machine receipts at the native client's display boundary. */
public final class CorticoChatFilter implements ClientModInitializer {
    private static final Pattern FORMATTING = Pattern.compile("§[0-9A-FK-ORa-fk-or]");
    private static final Pattern RECEIPT = Pattern.compile("^MC_[A-Z0-9_]+\\s+\\{");
    private long hidden;

    public static boolean isMachineMessage(String text) {
        return RECEIPT.matcher(FORMATTING.matcher(text).replaceAll("").stripLeading()).find();
    }

    @Override
    public void onInitializeClient() {
        ClientReceiveMessageEvents.ALLOW_GAME.register((message, overlay) -> {
            if (!isMachineMessage(message.getString())) return true;
            hidden++;
            if (hidden == 1 || hidden % 128 == 0) {
                System.out.println("[CorticoChatFilter] Hidden machine system messages: " + hidden);
            }
            return false;
        });
        System.out.println("[CorticoChatFilter] Active: structured MC_* system messages are hidden");
    }
}
