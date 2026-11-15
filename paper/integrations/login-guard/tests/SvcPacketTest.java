package org.afuhome.auth;

import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.util.*;

public final class SvcPacketTest {
    static int checks;
    static void check(boolean b,String s){checks++;if(!b)throw new AssertionError(s);}
    static void rejects(byte[] packet){
        try{SvcAddressRouting.rewrite(packet,"voice.example.org:24454");throw new AssertionError("accepted unsupported packet");}
        catch(IllegalArgumentException expected){checks++;}
    }
    public static void main(String[] args){
        var settings=SvcAddressTest.settings();
        for(String host:List.of("", "old.example.org:12345", "a".repeat(128), "中文.example.org")){
            byte[] original=SvcAddressTest.packet(host);
            for(String next:List.of("voice.example.org:24454","[2001:db8::1]:24454","a".repeat(200)+":24454")){
                byte[] changed=SvcAddressRouting.rewrite(original,next);
                check(SvcAddressTest.host(changed).equals(next),"short/long UTF string round trip");
                check(Arrays.equals(Arrays.copyOf(original,54),Arrays.copyOf(changed,54)),"preserve secret/UUID/settings");
                check(changed[changed.length-1]==original[original.length-1],"preserve recording choice");
            }
        }
        for(String key:List.of("svc-route.public-host","svc-route.lan-host","svc-route.loopback-host"))
            for(String invalid:List.of("", "host", "host:0", "host:65536", "host:abc", "https://host:24454",
                    "host/path:24454", "user@host:24454", " host:24454", "host\n:24454", "[fe80::1%eth0]:24454",
                    "[dns.example]:24454", "256.0.0.1:24454", "01.2.3.4:24454", ".host:24454", "host.:24454")){
                var p=SvcAddressTest.settings();p.setProperty(key,invalid);
                try{SvcAddressRouting.load(p);throw new AssertionError("accepted invalid endpoint "+key);}
                catch(IllegalArgumentException expected){checks++;}
            }
        for(String cidr:List.of("0.0.0.0/0","192.168.3.0/15","192.168.3.1/24","10.0.0.0/7",
                "172.16.0.0/11","192.168.3.0/33","192.168.3.0","example.org/24","192.168.03.0/24")){
            var p=SvcAddressTest.settings();p.setProperty("svc-route.lan-cidr",cidr);
            try{SvcAddressRouting.load(p);throw new AssertionError("accepted unsafe LAN range");}
            catch(IllegalArgumentException expected){checks++;}
        }
        check(SvcAddressRouting.load(settings).route(InetSocketAddress.createUnresolved("unknown",1)).category().equals("public"),"unresolved peers never get LAN address");
        var publicOnly=new Properties();publicOnly.setProperty("svc-route.enabled","true");publicOnly.setProperty("svc-route.public-host","[::1]:24454");
        check(SvcAddressRouting.load(publicOnly).route(new InetSocketAddress("192.168.3.25",1)).category().equals("public"),"LAN routing is explicit, optional");
        byte[] base=SvcAddressTest.packet("");
        for(int size=0;size<base.length;size++)rejects(Arrays.copyOf(base,size));
        rejects(Arrays.copyOf(base,base.length+1));
        for(int position:new int[]{36,53,base.length-1}){byte[] bad=base.clone();bad[position]=(byte)255;rejects(bad);}
        for(int position:new int[]{16,37,49}){byte[] bad=base.clone();ByteBuffer.wrap(bad).putInt(position,-1);rejects(bad);}
        byte[] bad=base.clone();ByteBuffer.wrap(bad).putDouble(41,Double.NaN);rejects(bad);
        bad=Arrays.copyOf(base,57);bad[54]=(byte)128;bad[55]=0;rejects(bad);
        bad=SvcAddressTest.packet("x");bad[55]=(byte)255;rejects(bad);
        // Random malformed packets must not escape as indexing/runtime errors.
        var random=new Random(20261114);
        for(int n=0;n<2000;n++){
            byte[] fuzz=new byte[random.nextInt(800)];random.nextBytes(fuzz);
            try{SvcAddressRouting.rewrite(fuzz,"voice.example.org:24454");}
            catch(IllegalArgumentException expected){}checks++;
        }
        System.out.println("PASS "+checks+" SVC packet/configuration checks");
    }
}
