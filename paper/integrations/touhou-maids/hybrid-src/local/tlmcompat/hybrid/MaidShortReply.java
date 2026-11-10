package local.tlmcompat.hybrid;

/** One canonical spoken sentence for public text, bubble, receipt and audio. */
final class MaidShortReply {
    static final int LIMIT=40;
    static String text(String input){
        if(input==null)return "";
        String value=input.replaceAll("[\\p{Cntrl}§]"," ").replaceAll("\\s+"," ").strip();
        StringBuilder plain=new StringBuilder();
        value.codePoints().filter(c->Character.getType(c)!=Character.OTHER_SYMBOL&&c!=0xFE0F&&c!=0x200D).forEach(plain::appendCodePoint);
        value=plain.toString().replaceAll("^[\\s>*#`]+","").strip();
        int points=0,clause=-1;
        for(int i=0;i<value.length();){
            int c=value.codePointAt(i);int next=i+Character.charCount(c);points++;
            if(points<=LIMIT&&"。！？!?".indexOf(c)>=0)return value.substring(0,next).strip();
            if(points>=12&&points<LIMIT&&"，,；;".indexOf(c)>=0)clause=i;
            if(points>=LIMIT&&next<value.length())return clause>=0?value.substring(0,clause).strip()+"。":value.substring(0,i).strip()+"…";
            i=next;
        }
        return value.strip();
    }
}
