/* SPDX-License-Identifier: LGPL-3.0-only */
package com.dwinovo.numen.api.brain;

import com.dwinovo.numen.api.entity.NumenPlayer;
import com.dwinovo.numen.api.mcp.server.McpMode;
import com.dwinovo.numen.api.platform.ServerLifecycle;
import net.minecraft.server.level.ServerPlayer;
import java.util.UUID;

/** An authenticated game connection can drive only its own current body. */
public final class ClientDrivers {
    private static final ClientDriverBook BOOK=new ClientDriverBook(64);
    static { ServerLifecycle.onStopped(BOOK::closeAll); }
    private ClientDrivers() {}
    public static ClientDriverBook.Lease acquire(ServerPlayer owner,NumenPlayer body,Object connection,Runnable lost){
        if(!owner.server.isSameThread())throw new IllegalStateException("server thread required");
        if(!body.isOwnedByPlayer(owner.getUUID())||McpMode.instance().driving(owner.getUUID(),body.getUUID())
                ||ReleaseClients.driving(owner.getUUID(),body.getUUID()))return null;
        ClientDriverBook.Lease lease=BOOK.acquire(owner.getUUID(),body.getUUID(),connection,
                ()->owner.server.getPlayerList().getPlayer(owner.getUUID())==owner
                        &&NumenPlayer.findByUuid(owner.server,body.getUUID())==body
                        &&body.isAlive()&&!body.isRemoved()&&body.isOwnedByPlayer(owner.getUUID())
                        &&!McpMode.instance().driving(owner.getUUID(),body.getUUID()),lost);
        if(lease!=null)CompanionLoops.get(body.getUUID()).ifPresent(CompanionLoop::tick);
        return lease;
    }
    public static boolean driving(UUID owner,UUID body){return BOOK.driving(owner,body);}
}
