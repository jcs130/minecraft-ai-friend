/* SPDX-License-Identifier: LGPL-3.0-only */
package com.dwinovo.numen.api.brain;

import java.util.*;
import java.util.function.BooleanSupplier;

/** Game-client leases do not impersonate a remote MCP or legacy Numen session. */
public final class ClientDriverBook {
    private final Map<UUID,Lease> bodies=new HashMap<>();
    private final int maximum;
    public ClientDriverBook(int maximum){this.maximum=maximum;}
    public final class Lease implements AutoCloseable {
        private final UUID owner,body;
        private final Object connection;
        private final BooleanSupplier live;
        private final Runnable lost;
        private boolean closed;
        private Lease(UUID owner,UUID body,Object connection,BooleanSupplier live,Runnable lost){
            this.owner=owner;this.body=body;this.connection=connection;this.live=live;this.lost=lost;
        }
        public boolean current(){
            if(closed||bodies.get(body)!=this)return false;
            if(!live.getAsBoolean()){close();return false;}return true;
        }
        @Override public void close(){
            if(closed)return;closed=true;bodies.remove(body,this);lost.run();
        }
    }
    public Lease acquire(UUID owner,UUID body,Object connection,BooleanSupplier live,Runnable lost){
        Objects.requireNonNull(owner);Objects.requireNonNull(body);Objects.requireNonNull(connection);
        Lease old=bodies.get(body);
        if(old!=null&&old.current())return old.owner.equals(owner)&&old.connection==connection?old:null;
        if(bodies.containsKey(body))return null;
        if(bodies.size()>=maximum||!live.getAsBoolean())return null;
        Lease lease=new Lease(owner,body,connection,live,lost);bodies.put(body,lease);return lease;
    }
    public boolean driving(UUID owner,UUID body){Lease l=bodies.get(body);return l!=null&&l.owner.equals(owner)&&l.current();}
    public void closeAll(){for(Lease l:List.copyOf(bodies.values()))l.close();}
}
