package org.qiandengji.geyserlan;

import java.net.InetAddress;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import java.util.function.LongSupplier;

/** Bounded, address-scoped discovery challenges. No account names or credentials. */
public final class LanAdmissionLedger {
    private static final long ROTATE_MS=30_000, TTL_MS=90_000;
    private final int network, mask;
    private final LongSupplier clock;
    private final SecureRandom random=new SecureRandom();
    private final Map<String,ArrayDeque<Ticket>> tickets=new HashMap<>();
    private final Map<String,Long> spent=new HashMap<>();
    private record Ticket(String nonce,long at) {}

    public LanAdmissionLedger(String cidr) { this(cidr,System::currentTimeMillis); }
    LanAdmissionLedger(String cidr,LongSupplier clock) {
        String[] parts=cidr.split("/",-1);
        if(parts.length!=2)throw new IllegalArgumentException("Expected an explicit private IPv4 CIDR");
        String[] bytes=parts[0].split("\\.",-1);
        if(bytes.length!=4)throw new IllegalArgumentException("Expected IPv4");
        int value=0;
        for(String b:bytes) { if(!b.matches("0|[1-9][0-9]{0,2}"))throw new IllegalArgumentException("IPv4 octet"); int n=Integer.parseInt(b);if(n>255)throw new IllegalArgumentException("IPv4 octet");value=(value<<8)|n; }
        int prefix=Integer.parseInt(parts[1]);
        if(prefix<24||prefix>30)throw new IllegalArgumentException("LAN scope must be /24 to /30");
        this.mask=-1<<(32-prefix);this.network=value&mask;this.clock=clock;
        boolean privateRange=(value>>>24)==10||(value>>>20)==0xac1||(value>>>16)==0xc0a8;
        if(!privateRange||network!=value)throw new IllegalArgumentException("Expected aligned RFC1918 network");
    }
    public boolean allowed(InetAddress address) {
        if(address==null)return false;
        byte[] b=address.getAddress();if(b.length!=4)return false;
        int v=0;for(byte x:b)v=(v<<8)|(x&255);
        return (v&mask)==network&&v!=network&&v!=(network|~mask);
    }
    private void prune(long now) {
        tickets.values().forEach(q->q.removeIf(t->now-t.at()>TTL_MS));
        tickets.values().removeIf(Deque::isEmpty);
        spent.values().removeIf(at->now-at>TTL_MS);
    }
    public synchronized String challenge(InetAddress address) {
        if(!allowed(address))return null;
        long now=clock.getAsLong();prune(now);
        String ip=address.getHostAddress();
        if(tickets.size()>=256&&!tickets.containsKey(ip))return null;
        var q=tickets.computeIfAbsent(ip,k->new ArrayDeque<>());
        if(q.isEmpty()||now-q.getLast().at()>=ROTATE_MS) {
            byte[] b=new byte[16];random.nextBytes(b);q.add(new Ticket(HexFormat.of().formatHex(b),now));
        }
        return q.getLast().nonce();
    }
    /** Called only after the upstream Mojang chain AND client JWT signature checks. */
    public synchronized String consume(InetAddress address,boolean signed,String nonce,byte[] verifiedPayload) {
        if(!signed)return "LAN_LOGIN_UNSIGNED";
        if(!allowed(address))return "LAN_SOURCE_DENIED";
        if(nonce==null||nonce.length()>128||verifiedPayload==null||verifiedPayload.length>1_048_576)return "LAN_CHALLENGE_MISSING";
        long now=clock.getAsLong();prune(now);
        var q=tickets.get(address.getHostAddress());
        if(q==null||q.stream().noneMatch(t->MessageDigest.isEqual(t.nonce().getBytes(java.nio.charset.StandardCharsets.UTF_8),nonce.getBytes(java.nio.charset.StandardCharsets.UTF_8))))return "LAN_CHALLENGE_EXPIRED_OR_WRONG";
        try {
            String digest=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(verifiedPayload));
            if(spent.containsKey(digest))return "LAN_LOGIN_REPLAY";
            if(spent.size()>=4096)return "LAN_LOGIN_BUSY";
            spent.put(digest,now);return null;
        } catch(java.security.NoSuchAlgorithmException impossible) { throw new AssertionError(impossible); }
    }
}
