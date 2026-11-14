package org.afuhome.auth;

import java.net.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;

/** SVC 2.6.x protocol 20 SecretPacket: rewrite only its advertised endpoint.
 * No DNS, socket, token cache or authentication state is used by this helper. */
final class SvcAddressRouting {
    static final SvcAddressRouting DISABLED=new SvcAddressRouting(null,null,null,0,0);
    private final String publicHost,lanHost,loopbackHost;
    private final int lanNetwork,lanMask;
    private SvcAddressRouting(String publicHost,String lanHost,String loopbackHost,int network,int mask){
        this.publicHost=publicHost;this.lanHost=lanHost;this.loopbackHost=loopbackHost;
        lanNetwork=network;lanMask=mask;
    }
    boolean enabled(){return publicHost!=null;}
    static SvcAddressRouting load(Properties p){
        if(!Boolean.parseBoolean(p.getProperty("svc-route.enabled","false")))return DISABLED;
        String publicHost=endpoint(p.getProperty("svc-route.public-host"));
        String lanHost=p.getProperty("svc-route.lan-host"),cidr=p.getProperty("svc-route.lan-cidr");
        int network=0,mask=0;
        if(lanHost!=null||cidr!=null){
            lanHost=endpoint(lanHost);
            if(cidr==null||!cidr.matches("[0-9.]+/[0-9]{1,2}"))throw new IllegalArgumentException("LAN CIDR");
            String[] parts=cidr.split("/");network=ipv4(parts[0]);int bits=Integer.parseInt(parts[1]);
            boolean privateRange=(network>>>24)==10&&bits>=8
                ||(network>>>20)==0xAC1&&bits>=12||(network>>>16)==0xC0A8&&bits>=16;
            if(!privateRange||bits>32)throw new IllegalArgumentException("explicit private LAN required");
            mask=(int)(0xffffffffL<<(32-bits));
            if((network&mask)!=network)throw new IllegalArgumentException("LAN network has host bits");
        }
        String loopback=p.getProperty("svc-route.loopback-host");
        return new SvcAddressRouting(publicHost,lanHost,loopback==null?null:endpoint(loopback),network,mask);
    }
    record Route(String category,String host){}
    Route route(InetSocketAddress peer){
        InetAddress address=peer==null?null:peer.getAddress();
        if(address!=null&&address.isLoopbackAddress()&&loopbackHost!=null)return new Route("loopback",loopbackHost);
        if(address instanceof Inet4Address&&lanHost!=null){
            int value=ByteBuffer.wrap(address.getAddress()).getInt();
            if((value&lanMask)==lanNetwork)return new Route("lan",lanHost);
        }
        // Unresolved, IPv6 and other private networks get the public endpoint.
        return new Route("public",publicHost);
    }
    private static int ipv4(String value){
        String[] pieces=value.split("\\.",-1);if(pieces.length!=4)throw new IllegalArgumentException("IPv4");
        int result=0;for(String piece:pieces){
            if(!piece.matches("0|[1-9][0-9]{0,2}"))throw new IllegalArgumentException("IPv4 octet");
            int n=Integer.parseInt(piece);if(n>255)throw new IllegalArgumentException("IPv4 octet");result=(result<<8)|n;
        }return result;
    }
    private static String endpoint(String value){
        if(value==null||value.length()>320)throw new IllegalArgumentException("voice endpoint");
        int colon=value.lastIndexOf(':');if(colon<1)throw new IllegalArgumentException("explicit voice port required");
        String host=value.substring(0,colon),port=value.substring(colon+1);
        if(!port.matches("[1-9][0-9]{0,4}")||Integer.parseInt(port)>65535)throw new IllegalArgumentException("voice port");
        if(host.startsWith("[")){
            if(!host.endsWith("]"))throw new IllegalArgumentException("IPv6 brackets");
            String literal=host.substring(1,host.length()-1);
            if(!literal.contains(":")||!literal.matches("[a-fA-F0-9:.]+"))throw new IllegalArgumentException("IPv6 literal");
            try{InetAddress.getByName(literal);}catch(UnknownHostException invalid){throw new IllegalArgumentException("IPv6 literal");}
        }else{
            if(host.length()>253)throw new IllegalArgumentException("voice host length");
            if(host.matches("[0-9.]+"))ipv4(host);
            else for(String label:host.split("\\.",-1)){
                if(!label.matches("[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"))throw new IllegalArgumentException("voice hostname");
            }
        }
        return value;
    }
    /** Null means unchanged. Unsupported packets throw and are forwarded unmodified.
     * Preserve the original secret, backend UUID, port, audio settings and last flag. */
    static byte[] rewrite(byte[] data,String destination){
        if(data.length<56||data.length>570)throw new IllegalArgumentException("SVC secret layout");
        ByteBuffer b=ByteBuffer.wrap(data);
        int port=b.getInt(16),codec=data[36]&255,mtu=b.getInt(37),keepAlive=b.getInt(49);
        double distance=b.getDouble(41);
        if(port<1||port>65535||codec>2||mtu<1||mtu>65535||!Double.isFinite(distance)||distance<0
                ||keepAlive<1||(data[53]!=0&&data[53]!=1))throw new IllegalArgumentException("SVC secret fields");
        int at=54,length=0,shift=0,value;
        do{
            if(at>=data.length||shift>=14)throw new IllegalArgumentException("SVC host length");
            value=data[at++]&255;length|=(value&127)<<shift;shift+=7;
        }while((value&128)!=0);
        if(length>512||at+length+1!=data.length||(at>55&&length<128)
                ||(data[data.length-1]!=0&&data[data.length-1]!=1))throw new IllegalArgumentException("SVC secret trailer");
        String old;
        try{old=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(data,at,length)).toString();}
        catch(CharacterCodingException invalid){throw new IllegalArgumentException("SVC host encoding");}
        if(old.equals(destination))return null;
        byte[] utf=destination.getBytes(StandardCharsets.UTF_8);
        var out=ByteBuffer.allocate(57+utf.length);out.put(data,0,54);
        int n=utf.length;do{out.put((byte)((n&127)|(n>127?128:0)));n>>>=7;}while(n!=0);
        out.put(utf).put(data[data.length-1]);return Arrays.copyOf(out.array(),out.position());
    }
}
