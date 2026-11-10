package dev.god.godvoice;
import java.util.*;
public final class VoiceUploadTraceTest {
 public static void main(String[] args)throws Exception {
  var uploads=new VoiceUploads();var actor=UUID.randomUUID();var session=UUID.randomUUID();var key=new VoiceUploads.Key(actor,UUID.randomUUID());
  uploads.begin(key,session,2,"a".repeat(64),"wav",1000);
  var before=uploads.snapshot(key,session,1001);if(!before.pending()||!before.sessionMatches()||before.nextSequence()!=0||before.expectedBytes()!=2)throw new AssertionError();
  if(uploads.snapshot(key,UUID.randomUUID(),1001).sessionMatches())throw new AssertionError();
  byte[] frame=new byte[23];frame[0]=2;frame[20]=1;var trace=new VoiceUploadTrace();
  var row=trace.rejection(actor,session,key.request(),frame,before,"UPLOAD_CHUNK_INVALID",true,true,1001);
  if(!row.get("sequence").equals(1)||!row.get("chunkBytes").equals(2)||row.containsKey("audio"))throw new AssertionError(row);
  for(int n=1;n<16;n++)if(trace.rejection(actor,session,key.request(),frame,before,"UPLOAD_CHUNK_INVALID",true,true,1001)==null)throw new AssertionError();
  if(trace.rejection(actor,session,key.request(),frame,before,"UPLOAD_CHUNK_INVALID",true,true,1001)!=null)throw new AssertionError();
  row=trace.rejection(actor,session,null,new byte[1],null,"private text!!",false,false,61002);
  if(!row.get("suppressedSincePrevious").equals(1)||!row.get("code").equals("VOICE_PROTOCOL_INVALID")||row.get("sequence")!=null)throw new AssertionError(row);
  uploads.discard(key,session);if(uploads.snapshot(key,session,61002).pending()||!before.pending())throw new AssertionError();
  System.out.println("PASS bounded upload rejection trace: sequence/size/session/pre-discard/short-frame/rate/redaction");
 }
}
