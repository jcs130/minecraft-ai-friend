package dev.qiandeng.maid;

import java.io.ByteArrayOutputStream;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;

/** Bounds bytes while receiving, before JSON parsing or buffering the full response. */
public final class BoundedResponse implements HttpResponse.BodySubscriber<byte[]> {
    private final int maximum;
    private final ByteArrayOutputStream data = new ByteArrayOutputStream();
    private final CompletableFuture<byte[]> result = new CompletableFuture<>();
    private Flow.Subscription subscription;
    public BoundedResponse(int maximum) { this.maximum = maximum; }
    @Override public CompletionStage<byte[]> getBody() { return result; }
    @Override public void onSubscribe(Flow.Subscription value) {
        if (subscription != null) { value.cancel(); return; }
        subscription = value; value.request(1);
    }
    @Override public void onNext(List<ByteBuffer> buffers) {
        if (result.isDone()) return;
        for (ByteBuffer buffer : buffers) {
            if (buffer.remaining() > maximum - data.size()) {
                subscription.cancel(); result.completeExceptionally(new IllegalStateException("response_too_large")); return;
            }
            byte[] bytes = new byte[buffer.remaining()]; buffer.get(bytes); data.writeBytes(bytes);
        }
        subscription.request(1);
    }
    @Override public void onError(Throwable error) { result.completeExceptionally(error); }
    @Override public void onComplete() { result.complete(data.toByteArray()); }
}
