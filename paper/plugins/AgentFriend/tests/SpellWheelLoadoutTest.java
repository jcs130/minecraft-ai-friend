package org.afuhome.agentfriend;

import java.util.List;

public final class SpellWheelLoadoutTest {
    private static int checks;
    private static void check(boolean value,String name) {
        if(!value)throw new AssertionError(name);checks++;System.out.println("PASS "+name);
    }
    private static void rejects(Runnable action,String name) {
        try{action.run();throw new AssertionError(name);}catch(IllegalArgumentException expected){checks++;System.out.println("PASS "+name);}
    }
    public static void main(String[] args) {
        var learned=List.of("mage_arcane_missile","mage_frost_armor");
        var defaults=SpellWheelLoadout.read(null,learned);
        check(defaults.size()==8&&defaults.getFirst().equals(learned.getFirst()),"default includes already learned profession spells");
        check(defaults.contains("selfheal")&&defaults.contains("blink"),"default keeps healing and movement");
        check(SpellWheelLoadout.defaults(List.of()).size()==8,"unselected player retains eight common shortcuts");
        var moved=SpellWheelLoadout.assign(defaults,7,learned.getFirst(),learned);
        check(moved.getFirst().isEmpty()&&moved.get(7).equals(learned.getFirst()),"moving a shortcut does not duplicate it");
        check(defaults.getFirst().equals(learned.getFirst()),"editing another snapshot preserves original slots");
        var cleared=SpellWheelLoadout.assign(moved,7,"",List.of());
        check(cleared.get(7).isEmpty(),"clear needs no spell learning or active spell mutation");
        check(SpellWheelLoadout.read(cleared,List.of("new_spell")).equals(cleared),"configured order and empty slots survive new skills");
        check(SpellWheelLoadout.read(moved,List.of()).equals(moved),"unavailable skill remains recorded for display and reconfiguration");
        rejects(()->SpellWheelLoadout.assign(defaults,1,"foreign_unlearned",learned),"cannot configure another class or unlearned skill");
        rejects(()->SpellWheelLoadout.assign(defaults,8,"",List.of()),"ninth slot rejected");
        rejects(()->SpellWheelLoadout.assign(defaults,-1,"",List.of()),"negative slot rejected");
        rejects(()->SpellWheelLoadout.read(List.of("bad"),learned),"malformed saved list is not silently replaced");
        rejects(()->SpellWheelLoadout.read(List.of("/op x","","","","","","",""),learned),"commands cannot be stored as spells");
        rejects(()->SpellWheelLoadout.read(List.of(1,"","","","","","",""),learned),"non-string preference rejected");
        System.out.println("checks="+checks);
    }
}
