package dev.qiandeng.maw.saoforge;

import net.minecraft.network.chat.Component;

/** FTB's localized getTitle() is @OnlyIn(CLIENT); raw titles exist server-side. */
public final class FtbServerTitles {
    private FtbServerTitles(){}
    public static Component title(Object questObject) {
        try {
            String raw=(String)questObject.getClass().getMethod("getRawTitle").invoke(questObject);
            if(raw.isBlank())raw="[quest "+questObject.getClass().getMethod("getCodeString").invoke(questObject)+"]";
            if(raw.startsWith("{")||raw.startsWith("[")){
                try{var component=Component.Serializer.fromJson(raw);if(component!=null)return component;}catch(RuntimeException ignored){}
            }
            return Component.literal(raw);
        }catch(ReflectiveOperationException unavailable){throw new IllegalStateException("native_ftb_raw_title_unavailable",unavailable);}
    }
}
