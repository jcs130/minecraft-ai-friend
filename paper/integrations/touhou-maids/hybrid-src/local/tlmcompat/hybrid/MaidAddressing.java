package local.tlmcompat.hybrid;

/** Addressing is deterministic; ordinary conversation never wakes a model. */
final class MaidAddressing {
    private MaidAddressing(){}
    static String addressed(String name,String text){
        if(name==null||name.isBlank()||text==null)return null;
        String value=text.strip();
        if(value.startsWith("@"))value=value.substring(1);
        if(!value.startsWith(name))return null;
        value=value.substring(name.length());
        if(value.isEmpty())return null;
        int first=value.codePointAt(0);
        if(!(Character.isWhitespace(first)||"，,:：!！?？、".indexOf(first)>=0))return null;
        value=value.stripLeading().replaceFirst("^[，,:：!！?？、]+\\s*", "").strip();
        return value.isEmpty()||value.length()>140||value.codePoints().anyMatch(c->Character.isISOControl(c)||c==0xA7)?null:value;
    }
}
