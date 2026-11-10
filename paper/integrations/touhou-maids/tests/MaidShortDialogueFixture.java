package local.tlmcompat.hybrid;

public final class MaidShortDialogueFixture {
    static int count;
    static void check(boolean ok,String name){count++;if(!ok)throw new AssertionError(name);}
    public static void main(String[] args){
        check(MaidShortReply.text(null).isEmpty(),"null reply stays empty");
        check(MaidShortReply.text(" \n ").isEmpty(),"empty model reply is not invented");
        check(MaidShortReply.text("🌸😊").isEmpty(),"emoji-only reply stays empty");
        check(MaidShortReply.text("可米，这里我来留意。你先看清机关再动手。").equals("可米，这里我来留意。"),"one complete sentence instead of a lecture");
        check(MaidShortReply.text("可米，我在这里").equals("可米，我在这里"),"already short text is preserved");
        check(MaidShortReply.text("**可米，今天的探索真有意思！🌸 然后我们去休息吧。").equals("可米，今天的探索真有意思！"),"formatting and emoji do not reach chat or TTS");
        String longReply="这一段没有任何句号而且确实非常非常长，我们先观察这块石头是否真的已经挖开，再决定下一步的行动而不是反复让伙伴停下休息";
        String shorter=MaidShortReply.text(longReply);
        check(shorter.codePointCount(0,shorter.length())<=40,"long reply is bounded by Unicode characters");
        check(shorter.endsWith("。"),"prefer a complete nearby clause");
        String supplementary="𠀀".repeat(60),cut=MaidShortReply.text(supplementary);
        check(cut.codePointCount(0,cut.length())==40&&cut.endsWith("…"),"hard limit never splits a supplementary character");
        check(MaidShortReply.text("字".repeat(40)).length()==40,"exact limit is not needlessly truncated");
        check(MaidShortReply.text("字".repeat(41)).length()==40,"one character over the limit is bounded");
        check(MaidShortReply.text(shorter).equals(shorter),"normalization is idempotent across text and speech");
        check(MaidShortReply.text("\u0000可米，\n继续吧。第二句。§").equals("可米， 继续吧。"),"control characters are not forwarded");
        var q=new MaidSpeechQueue<String>();
        check(q.peek()==null&&q.take()==null,"empty speech queue");
        check(q.offer("original-request-1",0)==null,"one original request is queued once");
        check(!q.peek().expired(MaidSpeechQueue.MAX_WAIT-1),"fresh waiting reply may still start");
        check(q.peek().expired(MaidSpeechQueue.MAX_WAIT),"expiry includes the exact deadline");
        check(q.offer("original-request-2",5).equals("original-request-1"),"latest reply replaces the only waiting reply");
        check(q.peek().item().equals("original-request-2"),"no unbounded dialogue backlog");
        check(q.take().item().equals("original-request-2")&&q.take()==null,"promotion consumes the original ID once");
        System.out.println("PASS "+count+" short dialogue and bounded waiting checks");
    }
}
