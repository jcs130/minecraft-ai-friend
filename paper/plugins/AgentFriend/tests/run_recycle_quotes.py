"""Compile actual quote issuance/storage methods with synthetic items only."""
import argparse,re,subprocess,tempfile,os
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--source',type=Path);p.add_argument('--jdk',type=Path,required=True);a=p.parse_args()
source=a.source or Path(__file__).parents[1]/'src/org/afuhome/agentfriend/ArenaEconomy.java'
s=source.read_text(encoding='utf-8')
field=re.search(r'    private final Map<UUID,.*> quotes = new HashMap<>\(\);',s).group()
record=re.search(r'    private record Quote\([\s\S]*?\{ \}',s).group()
ttl=re.search(r'    (?:private )?static final long QUOTE_LIFETIME_MS = .*;',s).group()
helpers='\n'.join(re.findall(r'    private (?:void|Quote) (?:rememberQuote|findQuote|slotQuote|consumeQuote)\([\s\S]*?^    \}',s,re.M))
issue=re.search(r'        int price = unitPrice\(stack\) \* quantity;[\s\S]*?(?=        JsonObject details)',s).group()
code='''import java.util.*;
public class QuoteQa {
FIELDS
 static byte[] digest(byte[] b){return b;} static int unitPrice(Stack s){return 3;}
 record Stack(){byte[] serializeAsBytes(){return new byte[]{1};}}
 void issue(UUID owner,boolean stash,int slot,int quantity){Stack stack=new Stack();ISSUE}
 Quote read(UUID owner,int slot){Object o=quotes.get(owner);if(o instanceof Map<?,?> m)return m.values().stream().map(q->(Quote)q).filter(q->q.slot()==slot).findFirst().orElse(null);return o instanceof Quote q&&q.slot()==slot?q:null;}
 static int n;static void check(boolean b,String why){if(!b)throw new AssertionError(why);n++;}
 public static void main(String[]x)throws Exception{
   var q=new QuoteQa();UUID a=UUID.randomUUID(),b=UUID.randomUUID();
   for(int i=0;i<10;i++)q.issue(a,true,i,1);
   for(int i=0;i<10;i++)check(q.read(a,i)!=null,"Batch quote overwritten: slot "+i);
   Quote old=q.read(a,0);q.issue(a,true,0,2);
   check(!q.read(a,0).id().equals(old.id()),"same-slot reprice must replace its ID");
   check(q.read(a,0).quantity()==2,"quantity snapshot");
   check(q.read(a,1)!=null,"reprice preserves other slots");
   q.issue(b,true,0,1);check(!q.read(a,0).id().equals(q.read(b,0).id()),"owners isolated");
   check(q.read(a,0).expiresAt()-System.currentTimeMillis()>290000,"agent has five minutes");
   for(int i=10;i<45;i++)q.issue(a,true,i,1);
   check(((Map<?,?>)(Object)q.quotes.get(a)).size()==32,"bounded pending quotes");
   var find=QuoteQa.class.getDeclaredMethod("findQuote",UUID.class,String.class);
   var consume=QuoteQa.class.getDeclaredMethod("consumeQuote",UUID.class,String.class);
   Quote newest=q.read(a,44);
   check(find.invoke(q,b,newest.id())==null,"cannot consume another owner's quote");
   consume.invoke(q,a,newest.id());check(find.invoke(q,a,newest.id())==null,"consumed ID cannot replay");
   consume.invoke(q,a,newest.id());check(q.read(a,43)!=null,"repeat consume preserves other quote");
   var remember=QuoteQa.class.getDeclaredMethod("rememberQuote",Quote.class);
   remember.invoke(q,new Quote(b,"expired",true,99,1,3,new byte[]{1},System.currentTimeMillis()-1));
   q.issue(a,false,2,1);check(q.read(b,99)==null,"expired books pruned");
   q.issue(a,true,2,1);check(((Map<?,?>)(Object)q.quotes.get(a)).values().stream().filter(v->((Quote)v).slot()==2).count()==2,"bag and chest slot namespaces differ");
   System.out.println(n+" production quote checks passed");
 }
}'''.replace('FIELDS','\n'.join([field,record,ttl,helpers])).replace('ISSUE',issue)
with tempfile.TemporaryDirectory(prefix='recycle-quotes-') as tmp:
    root=Path(tmp);(root/'QuoteQa.java').write_text(code,encoding='utf-8')
    suffix='.exe' if os.name=='nt' else ''
    subprocess.run([str(a.jdk/'bin'/('javac'+suffix)),'--release','21','-d',tmp,str(root/'QuoteQa.java')],check=True)
    subprocess.run([str(a.jdk/'bin'/('java'+suffix)),'-cp',tmp,'QuoteQa'],check=True)
