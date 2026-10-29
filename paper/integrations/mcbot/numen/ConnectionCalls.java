/* SPDX-License-Identifier: LGPL-3.0-only */
package com.dwinovo.numen.api.brain;

import java.util.*;
import java.util.function.BooleanSupplier;

/** Explicitly transient program calls: never replay a remote client's effects after restart. */
public final class ConnectionCalls {
    public static final String PREFIX="game-client-";
    private static final Map<String,Lease> OPEN=new HashMap<>();
    private ConnectionCalls() {}
    public static final class Lease implements AutoCloseable {
        private final String id;private final UUID body;private final BooleanSupplier current;
        private final List<Runnable> cancellations=new ArrayList<>();private boolean closed;
        private Lease(String id,UUID body,BooleanSupplier current){this.id=id;this.body=body;this.current=current;}
        @Override public void close(){
            if(closed)return;closed=true;OPEN.remove(id,this);
            try {for(Runnable cancel:List.copyOf(cancellations))cancel.run();}
            finally {cancellations.clear();}
        }
    }
    public static Lease open(UUID body,String id,BooleanSupplier current){
        Objects.requireNonNull(body);Objects.requireNonNull(current);
        if(!id.startsWith(PREFIX)||id.contains("#")||OPEN.containsKey(id)||OPEN.size()>=64||!current.getAsBoolean())
            throw new IllegalStateException("invalid or unavailable connection program");
        Lease lease=new Lease(id,body,current);OPEN.put(id,lease);return lease;
    }
    public static boolean transientCall(String call){return call!=null&&call.startsWith(PREFIX);}
    private static Lease lease(UUID body,String call){
        int split=call.indexOf('#');Lease lease=split<0?null:OPEN.get(call.substring(0,split));
        return lease!=null&&!lease.closed&&lease.body.equals(body)&&lease.current.getAsBoolean()?lease:null;
    }
    public static boolean allows(UUID body,String call){return !transientCall(call)||lease(body,call)!=null;}
    /** Watch the exact record, not whatever another driver may later put in the body slot. */
    public static boolean watch(UUID body,String call,Runnable cancel){
        if(!transientCall(call))return true;
        Lease lease=lease(body,call);if(lease==null)return false;
        if(lease.cancellations.size()>=64)throw new IllegalStateException("connection program task limit");
        lease.cancellations.add(cancel);return true;
    }
}
