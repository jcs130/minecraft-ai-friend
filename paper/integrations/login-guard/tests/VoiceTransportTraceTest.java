package org.afuhome.auth;
public final class VoiceTransportTraceTest {
 public static void main(String[] args)throws Exception {
  var f=new VoiceTransportTest.Fixture();var e=f.event(false,VoiceTransportTest.json("{\"op\":\"begin\",\"requestId\":\""+VoiceTransportTest.REQUEST+"\",\"text\":\"private words\",\"token\":\"secret\"}"));
  if(new VoiceTransportTrace(false).record(e,f.player,f.connection)!=null)throw new AssertionError();
  var trace=new VoiceTransportTrace(true);var row=trace.record(e,f.player,f.connection);
  if(!row.get("requestId").equals(VoiceTransportTest.REQUEST)||!row.get("frameBytes").equals(e.getData().length)||row.toString().contains("private words")||row.toString().contains("secret"))throw new AssertionError(row);
  for(int i=1;i<256;i++)if(trace.record(e,f.player,f.connection)==null)throw new AssertionError();
  if(trace.record(e,f.player,f.connection)!=null||!e.getResult().isAllowed())throw new AssertionError();
  System.out.println("PASS proxy trace disabled by default; 256-record bound and payload preservation/redaction");
 }
}
