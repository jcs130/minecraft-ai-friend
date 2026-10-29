package org.qiandengji.vortex;
import java.util.*;
/** Selection facts and version stability; game-side query purity is checked with real clients. */
public final class ClassInfoViewTest {
    static int checks;
    static void check(boolean value,String why){if(!value)throw new AssertionError(why);checks++;}
    public static void main(String[] args){
        check(ClassInfoView.selectionReason("","mage",true,true).equals("ready"),"new selectable role");
        check(ClassInfoView.selectionReason("knight","mage",true,true).equals("class_already_chosen"),"choose is not a hidden class swap");
        check(ClassInfoView.selectionReason("mage","mage",true,true).equals("already_selected"),"same role does not imply another kit");
        check(ClassInfoView.selectionReason("","mage",false,true).equals("player_state_blocked"),"downed/dead player cannot be told to choose");
        check(ClassInfoView.selectionReason("","mage",true,false).equals("permission_denied"),"command permission is not assumed");
        var a=new LinkedHashMap<String,Object>();a.put("name","法师");a.put("base",Map.of("INTELLIGENCE",8,"WISDOM",4));
        var b=new LinkedHashMap<String,Object>();b.put("base",Map.of("WISDOM",4,"INTELLIGENCE",8));b.put("name","法师");
        check(ClassInfoView.revision(List.of(a)).equals(ClassInfoView.revision(List.of(b))),"map iteration order cannot invalidate cached definitions");
        b.put("base",Map.of("WISDOM",4,"INTELLIGENCE",9));
        check(!ClassInfoView.revision(List.of(a)).equals(ClassInfoView.revision(List.of(b))),"real attribute changes invalidate definitions");
        check(!ClassInfoView.revision(List.of(Map.of("description","a,b=c"))).equals(ClassInfoView.revision(List.of(Map.of("description","a","b","c")))),"definition encoding is unambiguous");
        check(ClassInfoView.statText(Map.of("STRENGTH",6)).equals("力量 6"),"default text explains real attribute names");
        check(ClassInfoView.statText(Map.of("FUTURE_ATTRIBUTE",2)).equals("FUTURE_ATTRIBUTE 2"),"unknown native attributes are preserved");
        System.out.println("class-info="+checks);
    }
}
