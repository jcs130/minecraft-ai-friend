package org.afuhome.agentfriend;

import java.util.Set;
import java.util.UUID;

import static org.afuhome.agentfriend.BeaconExpedition.*;
import static org.afuhome.agentfriend.BeaconExpedition.Choice.*;

public final class BeaconExpeditionTest {
    private static int checks;

    private static void check(boolean valid, String label) {
        checks++;
        if (!valid) throw new AssertionError(label);
    }

    private static void rejects(Runnable call, String label) {
        checks++;
        try { call.run(); }
        catch (IllegalArgumentException expected) { return; }
        throw new AssertionError(label);
    }

    public static void main(String[] args) {
        UUID first = UUID.fromString("00000000-0000-0000-0000-000000000001");
        UUID second = UUID.fromString("00000000-0000-0000-0000-000000000002");
        Progress ready = Progress.fresh();
        var blessing = ready.choose(BRIEFING, first, EDGE);
        check(!blessing.advance() && blessing.progress().boon(first) == Boon.EDGE, "blessing saves without advancing");
        check(blessing.progress().boon(second) == null, "teammate blessing remains personal");
        rejects(() -> blessing.progress().choose(BRIEFING, first, AIM), "one opening blessing per person");
        check(blessing.progress().committed(first, BRIEFING, "edge"), "repeat reads original blessing");
        check(!blessing.progress().committed(second, BRIEFING, "edge"), "other participant cannot claim same blessing receipt");
        var scout = blessing.progress().choose(BRIEFING, first, SCOUT);
        Progress scouting = scout.progress();
        check(scout.advance() && scouting.stop(APPROACH) == Stop.SCOUT, "opening determines actual room");
        check(scouting.committed(second, BRIEFING, "scout"), "all teammates see the same committed route");
        rejects(() -> scouting.choose(APPROACH, second, GATE), "late route conflict does not change venue");
        var west = scouting.choose(APPROACH, first, SURVEY_WEST);
        check(!west.advance(), "one marked inspection cannot advance");
        rejects(() -> west.progress().choose(APPROACH, first, SURVEY_WEST), "same marker cannot count twice");
        var east = west.progress().choose(APPROACH, second, SURVEY_EAST);
        check(east.advance() && east.progress().scoutMarks() == 3, "two distinct marks advance once");
        var rescue = east.progress().choose(RESCUE, first, RELEASE);
        check(!rescue.advance() && !rescue.progress().clearedRescue(), "opening rescue is not safe arrival");
        rejects(() -> rescue.progress().choose(RESCUE, first, SALVAGE), "no fallback while escort is active");
        Progress safe = rescue.progress().withRescue(Rescue.SAFE);
        var refit = safe.choose(CAMP, first, WARD);
        check(!refit.advance() && refit.progress().boon(first) == Boon.WARD && refit.progress().strength(first) == 3, "camp refit after safe arrival");
        check(refit.progress().committed(first, BRIEFING, "edge"), "refit does not erase opening receipt");
        rejects(() -> refit.progress().choose(CAMP, first, EDGE), "camp refit is single use");
        Progress altar = refit.progress().choose(CAMP, second, ALTAR).progress();
        Progress recovered = Progress.restore(altar.save(), FINAL_ROUTE, Set.of(first, second));
        check(recovered.equals(altar) && recovered.stop(FINAL_ROUTE) == Stop.ALTAR, "route and personal state survive serialization");
        rejects(() -> Progress.restore(altar.save(), APPROACH, Set.of(first, second)), "wrong stage rejected");
        rejects(() -> Progress.restore(altar.save(), FINAL_ROUTE, Set.of(second)), "foreign owner blessing rejected");
        var oneSeal = recovered.choose(FINAL_ROUTE, first, SEAL_SOUTH);
        check(!oneSeal.advance() && !oneSeal.progress().altarDisabled(), "a single seal does not change combat");
        Progress disarmed = oneSeal.progress().choose(FINAL_ROUTE, first, SEAL_NORTH).progress();
        check(disarmed.altarDisabled() && disarmed.rewardCount(4) == 4, "altar disarms boss at base reward");
        check(Progress.restore(disarmed.save(), STAGES, Set.of(first, second)).equals(disarmed), "finished result preserved");
        rejects(() -> Progress.restore(oneSeal.progress().save(), BOSS, Set.of(first, second)), "boss checkpoint requires completed seals");
        Progress gate = ready.choose(BRIEFING, first, GATE).progress();
        check(gate.stop(APPROACH) == Stop.GATE && gate.choices(APPROACH, first).isEmpty(), "gate is actual combat branch");
        Progress stranded = gate.choose(RESCUE, first, RELEASE).progress().withRescue(Rescue.STRANDED);
        Progress fallback = stranded.choose(RESCUE, second, SALVAGE).progress();
        check(fallback.clearedRescue() && !fallback.safeRescue(), "fallback does not pretend to rescue");
        Progress vault = fallback.choose(CAMP, first, WARD).progress().choose(CAMP, first, VAULT).progress();
        check(vault.stop(FINAL_ROUTE) == Stop.VAULT && !vault.altarDisabled() && vault.rewardCount(4) == 6,
            "riskier combination keeps shock and stays within legacy six iron");
        check(vault.strength(first) == 2, "fallback has no rescue bonus");
        check(Progress.restore(vault.save(), FINAL_ROUTE, Set.of(first, second)).equals(vault), "vault route resumes as its own branch");
        Progress scoutVault = safe.choose(CAMP, first, VAULT).progress();
        check(scoutVault.rewardCount(4) == 5 && scoutVault.opening() == Opening.SCOUT && !scoutVault.altarDisabled(),
            "scout intelligence remains available on the vault route");
        Progress gateAltar = fallback.choose(CAMP, first, ALTAR).progress().choose(FINAL_ROUTE, first, SEAL_NORTH).progress()
            .choose(FINAL_ROUTE, first, SEAL_SOUTH).progress();
        check(gateAltar.rewardCount(4) == 5 && gateAltar.altarDisabled(), "gate effort and altar safety combine independently");
        var token = new Token(second.toString(), CAMP, "vault");
        check(token.equals(Token.parse(token.value())), "tokens round-trip");
        rejects(() -> Token.parse("vault"), "invented bare action cannot target current run");
        rejects(() -> Token.parse(second + ".5.vault"), "combat cannot accept route token");
        rejects(() -> Token.parse(second + ".3.vault.extra"), "extraneous token rejected");
        System.out.println("Lost Beacon choice/state checks: " + checks);
    }
}
