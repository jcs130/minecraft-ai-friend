package org.qiandeng.camera;

import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import com.elfmcys.yesstevemodel.OoooO0OO0000O00oo0Oo00OO;
import com.elfmcys.yesstevemodel.Oo0O0OoOo0O0oOoo0000O0oO;
import com.elfmcys.yesstevemodel.OoOO0o0O00o00OoOO0OO0OOo;
import com.elfmcys.yesstevemodel.oo0o0Oooo0OOO00OOo0OO000;

/** Read-only public API of the hash-pinned original NeoForge YSM 2.6.5 client. */
final class YsmAccess {
    static int catalogueSize() { return oo0o0Oooo0OOO00OOo0OO000.oOoo00O0o0oO0o0oO00OO0O0().size(); }
    static boolean hasModel(String model) { return oo0o0Oooo0OOO00OOo0OO000.oOoo00O0o0oO0o0oO00OO0O0().containsKey(model); }
    static NativeCameraClient.ModelSelection selection(Object value) {
        if (!(value instanceof Entity entity)) return null;
        // RenderPlayerEvent uses its own attachment; the generic entity
        // renderer is not the source of a player's current YSM selection.
        if(entity instanceof Player player){
            if(!player.hasData(OoooO0OO0000O00oo0Oo00OO.oOo0OO0O0o000OO0O000oo0o))return null;
            var model=OoooO0OO0000O00oo0Oo00OO.oOoo00O0o0oO0o0oO00OO0O0(player).orElse(null);
            return model==null?null:new NativeCameraClient.ModelSelection(model.O000OOo000oOOo0OO0oo0o0O(),null);
        }
        // The server's saved model_id attachment is not the client's render
        // selection. First prove the original renderer attachment exists so
        // the public optional getter cannot create one during observation.
        if(!entity.hasData(Oo0O0OoOo0O0oOoo0000O0oO.oOo0OO0O0o000OO0O000oo0o))return null;
        var model=OoOO0o0O00o00OoOO0OO0OOo.oOoo00O0o0oO0o0oO00OO0O0(entity).orElse(null);
        return model==null?null:new NativeCameraClient.ModelSelection(model.O000OOo000oOOo0OO0oo0o0O(),null);
    }
}
