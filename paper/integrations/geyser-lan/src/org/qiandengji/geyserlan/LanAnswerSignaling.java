package org.qiandengji.geyserlan;

import java.net.InetSocketAddress;
import org.cloudburstmc.netty.channel.nethernet.AddressSource;
import org.cloudburstmc.netty.channel.nethernet.signaling.NetherNetDiscoverySignaling;
import org.cloudburstmc.netty.channel.nethernet.signaling.NetherNetServerSignaling;

/** Compact answers only for unsigned offers from the explicitly configured household LAN. */
final class LanAnswerSignaling extends NetherNetDiscoverySignaling {
    private final LanAnswerPolicy answers = new LanAnswerPolicy();
    private final LanAdmissionLedger ledger;

    LanAnswerSignaling(long id, InetSocketAddress bind, LanAdmissionLedger ledger) {
        super(id, bind); this.ledger = ledger;
    }

    @Override public void setNewConnectionHandler(NetherNetServerSignaling.NewConnectionHandler handler) {
        super.setNewConnectionHandler((connection, network, offer, source, player) -> {
            boolean allowed = source != null && source.source() == AddressSource.SIGNALING_LAN
                    && source.address() != null && ledger.allowed(source.address().getAddress());
            answers.offered(connection, network, offer, allowed, player != null);
            handler.onConnect(connection, network, offer, source, player);
        });
    }

    @Override public void sendSignal(String network, String data) { super.sendSignal(network, answers.answer(network, data)); }
    @Override public void removeSignalHandler(String connection) { answers.closed(connection); super.removeSignalHandler(connection); }
    @Override public void close() { answers.clear(); super.close(); }
}
