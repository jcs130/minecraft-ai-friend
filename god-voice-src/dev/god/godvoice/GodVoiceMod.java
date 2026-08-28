package dev.god.godvoice;

import net.neoforged.fml.common.Mod;

/**
 * 天音·天耳 —— god-voice mod 入口壳。
 * 真正的工作由 GodVoicePlugin（SVC addon）承担；
 * 这个 @Mod 类只是让 jar 成为合法 NeoForge mod，
 * 让 SVC 能扫描到 @ForgeVoicechatPlugin 注解类。
 */
@Mod("godvoice")
public class GodVoiceMod {
    public GodVoiceMod() {
    }
}
