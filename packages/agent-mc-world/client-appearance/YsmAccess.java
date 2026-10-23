package org.agentmc.appearance;

import com.elfmcys.yesstevemodel.oOoOOoO0Ooo00O00OO0OOooO;

/** Verified YSM 2.4.1 client render capability; never sends a server selection. */
final class YsmAccess {
    static int catalogueSize() {
        return com.elfmcys.yesstevemodel.ooo00Oo0OoOo0o000O0oooOo.OOo0OOooo00OoO0oooooOOo0().size();
    }
    static boolean hasModel(String model) {
        return com.elfmcys.yesstevemodel.ooo00Oo0OoOo0o000O0oooOo.OOo0OOooo00OoO0oooooOOo0().containsKey(model);
    }
    static ClientAppearances.DisplaySelection selection(Object entity) {
        if (!(entity instanceof oOoOOoO0Ooo00O00OO0OOooO ysm)) return null;
        var data = ysm.OO0o0Oo000Oo00OoooO0OoOo().orElse(null);
        return data == null ? null : new ClientAppearances.DisplaySelection(data.oOoo00OOo00OoOOo00o00000(), data.Oo000Oo00OoOOooOOOO000oo());
    }
    static String enforce(Object entity, String model, String texture) {
        if (!(entity instanceof oOoOOoO0Ooo00O00OO0OOooO ysm)
                || !hasModel(model)) return null;
        var data = ysm.OO0o0Oo000Oo00OoooO0OoOo().orElse(null);
        if (data == null) return null;
        String beforeModel = data.oOoo00OOo00OoOOo00o00000(), beforeTexture = data.Oo000Oo00OoOOooOOOO000oo();
        if (model.equals(beforeModel) && texture.equals(beforeTexture)) return null;
        data.OOo0OOooo00OoO0oooooOOo0(model, texture);
        return beforeModel + "/" + beforeTexture + " -> "
                + data.oOoo00OOo00OoOOo00o00000() + "/" + data.Oo000Oo00OoOOooOOOO000oo();
    }
}
