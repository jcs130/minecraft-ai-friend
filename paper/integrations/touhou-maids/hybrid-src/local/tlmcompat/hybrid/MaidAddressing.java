package local.tlmcompat.hybrid;

/** Addressing is deterministic; ordinary conversation never wakes a model. */
final class MaidAddressing {
    private MaidAddressing(){}
    /** Owner-only vocatives in delivered nearby speech, not arbitrary name mentions. */
    static String partnerAddressed(String name,String text){
        String direct=addressed(name,text);
        if(direct!=null)return direct;
        if(name==null||name.isBlank()||text==null)return null;
        String value=text.strip();
        if(value.isEmpty()||value.length()>140||value.startsWith("/")||value.startsWith("!")
            ||value.codePoints().anyMatch(c->Character.isISOControl(c)||c==0xA7)
            ||value.matches(".*[\"“”「」『』].*"))return null;
        int at=value.indexOf(name);
        if(at<0)return null;
        String before=value.substring(0,at).strip();
        String after=value.substring(at+name.length());
        // Accept direct second-person address, or a short conversational vocative.
        // '我和肥鱼聊天' / '肥鱼池' remain third-person mentions, not calls.
        if(before.isEmpty()&&(after.startsWith("你")||after.startsWith("咱")))return value;
        if(!(before.isEmpty()||before.matches("(?:.*[，,。！!？?：:、\\s])?(?:拜托(?:啦|了)?|谢谢(?:你)?|辛苦(?:啦|了)?|走吧|走啦|跟上|等等|对了|好啦|好呀|嘿|喂|嗨)")))return null;
        if(after.isEmpty()||"，,:：!！?？、～~".indexOf(after.codePointAt(0))<0)return null;
        return value;
    }
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
