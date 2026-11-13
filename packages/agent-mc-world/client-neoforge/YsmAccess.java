package org.agentmc.appearance;
import net.minecraft.world.entity.player.Player;
import com.elfmcys.yesstevemodel.OoooO0OO0000O00oo0Oo00OO;
import com.elfmcys.yesstevemodel.oo0o0Oooo0OOO00OOo0OO000;

/** Original NeoForge 2.6.5 client attachment; observing never creates one or sends a selection. */
final class YsmAccess {
 static int catalogueSize(){return oo0o0Oooo0OOO00OOo0OO000.oOoo00O0o0oO0o0oO00OO0O0().size();}
 static boolean hasModel(String model){return oo0o0Oooo0OOO00OOo0OO000.oOoo00O0o0oO0o0oO00OO0O0().containsKey(model);}
 static ClientAppearances.DisplaySelection selection(Object entity){
  if(!(entity instanceof Player player))return null;
  var data=player.getExistingData(OoooO0OO0000O00oo0Oo00OO.oOo0OO0O0o000OO0O000oo0o).orElse(null);
  if(data==null)return null;
  String model=data.O000OOo000oOOo0OO0oo0o0O();
  if(!hasModel(model))return new ClientAppearances.DisplaySelection(model,null);
  try{return new ClientAppearances.DisplaySelection(model,data.oO0o0O0OoOOooooOo00O0o0o());}
  catch(RuntimeException pending){return new ClientAppearances.DisplaySelection(model,null);}
 }
 static String enforce(Object entity,String model,String texture){
  if(!(entity instanceof Player player)||!hasModel(model))return null;
  var data=player.getExistingData(OoooO0OO0000O00oo0Oo00OO.oOo0OO0O0o000OO0O000oo0o).orElse(null);if(data==null)return null;
  var before=selection(entity);if(before==null||model.equals(before.model())&&texture.equals(before.texture()))return null;
  data.oOo0OO0O0o000OO0O000oo0o(model,texture);var after=selection(entity);
  return before.model()+"/"+before.texture()+" -> "+(after==null?"unavailable":after.model()+"/"+after.texture());
 }
}
