package local.hosting;

import com.google.gson.JsonObject;
import com.mojang.authlib.GameProfile;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class NativePlayerCustodyTest {
    private static final UUID PLAYER=UUID.fromString("00000000-0000-4000-8000-000000000005");
    private static final UUID OWNER=UUID.fromString("00000000-0000-4000-8000-000000000006");
    private static final GameProfile EXACT=new GameProfile(PLAYER,"Synthetic");
    @TempDir Path slots;

    @AfterEach void close() { NativePlayerCustody.clear(); }

    private static JsonObject binding(String kind) {
        var body=new JsonObject();
        body.addProperty("entityUuid",PLAYER.toString());
        body.addProperty("bodyId",kind+"-original");
        body.addProperty("playerName",EXACT.getName());
        if (kind.equals("numen")) body.addProperty("nativeOwner",OWNER.toString());
        return body;
    }

    private static JsonObject slot(String character, String active) {
        var scope=new JsonObject();
        scope.addProperty("characterId",character);
        scope.add("mineflayer",binding("mineflayer"));
        scope.add("numen",binding("numen"));
        var state=new JsonObject();
        state.add("scope",scope);
        state.addProperty("activeKind",active);
        state.addProperty("generation",12);
        return state;
    }

    private static void gate(JsonObject state,String mode,String kind) {
        var gate=new JsonObject();
        gate.addProperty("mode",mode);
        gate.addProperty("kind",kind);
        state.add("playerGate",gate);
    }

    private void stage(JsonObject state) throws Exception {
        String character=state.getAsJsonObject("scope").get("characterId").getAsString();
        var directory=Files.createDirectories(slots.resolve(NativeResidentSlots.hash(character)));
        Files.writeString(directory.resolve("slot.json"),state.toString());
    }

    @Test void nativeBodyHoldsOriginalPlayerAcrossColdBootIncludingAlternateNameProfiles() throws Exception {
        var state=slot("synthetic","maid");
        stage(state); NativePlayerCustody.load(slots);
        assertFalse(NativePlayerCustody.admitsMineflayer(EXACT));
        assertFalse(NativePlayerCustody.admitsNumen(EXACT,OWNER));
        var alias=new GameProfile(OWNER,"sYNTHETIC");
        assertTrue(NativePlayerCustody.enrolled(alias));
        assertFalse(NativePlayerCustody.admitsMineflayer(alias));
        assertTrue(NativePlayerCustody.admitsMineflayer(new GameProfile(OWNER,"Other")));
    }

    @Test void onlyExactAdmittedKindCanJoinAndAdmissionDoesNotEnableGameplay() throws Exception {
        var state=slot("synthetic","");
        gate(state,"admitted","numen");
        stage(state); NativePlayerCustody.load(slots);
        var binding=NativePlayerCustody.bindings(state.getAsJsonObject("scope"));
        long expires=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(10);
        NativePlayerCustody.publish("synthetic",binding,state,expires);
        assertFalse(NativePlayerCustody.admitsMineflayer(EXACT));
        assertFalse(NativePlayerCustody.admitsNumen(EXACT,PLAYER));
        assertTrue(NativePlayerCustody.admitsNumen(EXACT,OWNER));
        assertFalse(NativePlayerCustody.fromState("synthetic",binding,state,expires).acceptsGameplay("numen"));
        NativePlayerCustody.load(slots);
        assertFalse(NativePlayerCustody.admitsNumen(EXACT,OWNER));
    }

    @Test void fencesBothKindsBeforeSourceLeavesAndMayReopenOnlyExactStableVariant() throws Exception {
        var state=slot("synthetic","mineflayer");
        gate(state,"fenced","mineflayer");
        stage(state); NativePlayerCustody.load(slots);
        var bindings=NativePlayerCustody.bindings(state.getAsJsonObject("scope"));
        assertFalse(NativePlayerCustody.admitsMineflayer(EXACT));
        assertFalse(NativePlayerCustody.admitsNumen(EXACT,OWNER));
        state.remove("playerGate");
        NativePlayerCustody.publish("synthetic",bindings,state,0);
        assertTrue(NativePlayerCustody.admitsMineflayer(EXACT));
        assertFalse(NativePlayerCustody.admitsMineflayer(new GameProfile(PLAYER,"Wrong")));
        assertFalse(NativePlayerCustody.admitsNumen(EXACT,OWNER));
    }

    @Test void invalidOriginalMappingOrDuplicateEnrollmentCannotOpenLogin() throws Exception {
        var state=slot("first","villager");
        stage(state); stage(slot("second","maid"));
        assertThrows(java.io.IOException.class,()->NativePlayerCustody.load(slots));
        var scope=state.getAsJsonObject("scope");
        scope.getAsJsonObject("numen").addProperty("playerName","Different");
        assertThrows(IllegalArgumentException.class,()->NativePlayerCustody.bindings(scope));
    }

    @Test void playerActiveStartupRequiresOriginalNativeCheckpoints() throws Exception {
        var state=slot("synthetic","mineflayer");
        state.getAsJsonObject("scope").add("maid",binding("maid"));
        var held=new JsonObject();
        held.addProperty("maid","c".repeat(64));
        state.add("held",held);
        stage(state);
        assertThrows(IllegalStateException.class,()->NativePlayerCustody.load(slots));
    }
}
