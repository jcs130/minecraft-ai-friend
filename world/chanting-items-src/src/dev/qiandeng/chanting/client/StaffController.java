package dev.qiandeng.chanting.client;

import net.minecraft.network.chat.Component;

/** Optional Controlify boundary with no external types on the ordinary client. */
public interface StaffController {
    boolean previousDown();
    boolean nextDown();
    boolean usePhysicallyHeld();
    Component previousGlyph();
    Component nextGlyph();
}
