package org.afuhome.agentfriend;

import com.google.gson.*;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.Flow;

/** Optional bounded embeddings client; only ranks existing catalog cards. Never used on the game thread. */
final class CommandEmbeddingIndex implements AutoCloseable {
    private final URI endpoint;
    private final String model,key;
    private final int timeoutMs;
    private final HttpClient client;
    private String revision;
    private List<double[]> vectors=List.of();
    CommandEmbeddingIndex(URI endpoint,String model,String key,int timeoutMs){
        String host=endpoint.getHost();
        if(endpoint.getUserInfo()!=null||endpoint.getQuery()!=null||endpoint.getFragment()!=null||host==null
            ||!endpoint.getScheme().equals("https")&&!(endpoint.getScheme().equals("http")&&Set.of("127.0.0.1","localhost","::1","[::1]").contains(host))
            ||model==null||model.isBlank()||model.length()>128)throw new IllegalArgumentException("EMBEDDING_CONFIGURATION_INVALID");
        this.endpoint=endpoint;this.model=model;this.key=key==null?"":key;
        this.timeoutMs=Math.max(200,Math.min(3000,timeoutMs));
        client=HttpClient.newBuilder().connectTimeout(Duration.ofMillis(this.timeoutMs)).followRedirects(HttpClient.Redirect.NEVER).build();
    }
    List<AgentCliRecovery.Match> lookup(String[] raw,List<AgentCliRecovery.Card> cards,AgentCliRecovery.Context context)throws Exception{
        if(cards.size()>512)throw new IllegalArgumentException("EMBEDDING_CATALOG_LIMIT");
        String query=AgentCliRecovery.semanticQuery(raw,context);if(query.isBlank())return List.of();
        String current=AgentCliRecovery.revision(cards);
        if(!current.equals(revision)){
            var next=new ArrayList<double[]>();
            for(int from=0;from<cards.size();from+=32){
                if(Thread.currentThread().isInterrupted())throw new InterruptedException();
                List<String> documents=cards.subList(from,Math.min(cards.size(),from+32)).stream().map(c->c.document().substring(0,Math.min(1000,c.document().length()))).toList();
                next.addAll(embed(documents));
            }
            if(next.size()!=cards.size())throw new IllegalArgumentException("EMBEDDING_CATALOG_MISMATCH");
            if(!next.isEmpty())for(double[] vector:next)if(vector.length!=next.getFirst().length)throw new IllegalArgumentException("EMBEDDING_DIMENSION");
            vectors=List.copyOf(next);revision=current;
        }
        return AgentCliRecovery.semantic(raw,cards,context,embed(List.of(query)).getFirst(),vectors);
    }
    private List<double[]> embed(List<String> inputs)throws Exception{
        var body=new JsonObject();body.addProperty("model",model);body.add("input",new Gson().toJsonTree(inputs));
        var request=HttpRequest.newBuilder(endpoint).timeout(Duration.ofMillis(timeoutMs)).header("Content-Type","application/json");
        if(!key.isBlank())request.header("Authorization","Bearer "+key);
        var response=client.send(request.POST(HttpRequest.BodyPublishers.ofString(body.toString())).build(),info->new LimitedBody());
        if(response.statusCode()!=200)throw new IllegalStateException("EMBEDDING_HTTP_REJECTED");
        JsonObject decoded=JsonParser.parseString(new String(response.body(),StandardCharsets.UTF_8)).getAsJsonObject();
        if(decoded.has("model")&&!decoded.get("model").getAsString().equals(model))throw new IllegalArgumentException("EMBEDDING_MODEL_MISMATCH");
        JsonArray rows=decoded.getAsJsonArray("data");
        if(rows==null||rows.size()!=inputs.size())throw new IllegalArgumentException("EMBEDDING_RESULT_COUNT");
        double[][] out=new double[inputs.size()][];int dimensions=-1;
        for(JsonElement item:rows){
            var row=item.getAsJsonObject();int index=row.get("index").getAsInt();
            if(index<0||index>=out.length||out[index]!=null)throw new IllegalArgumentException("EMBEDDING_RESULT_INDEX");
            JsonArray values=row.getAsJsonArray("embedding");if(values==null||values.size()<2||values.size()>8192)throw new IllegalArgumentException("EMBEDDING_DIMENSION");
            if(dimensions<0)dimensions=values.size();if(dimensions!=values.size())throw new IllegalArgumentException("EMBEDDING_DIMENSION");
            double[] vector=new double[values.size()];for(int n=0;n<vector.length;n++)vector[n]=values.get(n).getAsDouble();
            AgentCliRecovery.cosine(vector,vector);out[index]=vector;
        }
        return List.of(out);
    }
    @Override public void close(){client.shutdownNow();}
    private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private static final int LIMIT=8*1024*1024;
        private final CompletableFuture<byte[]> result=new CompletableFuture<>();
        private final ByteArrayOutputStream bytes=new ByteArrayOutputStream();
        private Flow.Subscription subscription;
        public CompletionStage<byte[]> getBody(){return result;}
        public void onSubscribe(Flow.Subscription value){subscription=value;value.request(1);}
        public void onNext(List<ByteBuffer> chunks){
            for(ByteBuffer chunk:chunks){if(bytes.size()+chunk.remaining()>LIMIT){subscription.cancel();result.completeExceptionally(new IllegalArgumentException("EMBEDDING_RESPONSE_LIMIT"));return;}byte[] part=new byte[chunk.remaining()];chunk.get(part);bytes.writeBytes(part);}
            subscription.request(1);
        }
        public void onError(Throwable failure){result.completeExceptionally(failure);}
        public void onComplete(){result.complete(bytes.toByteArray());}
    }
}
