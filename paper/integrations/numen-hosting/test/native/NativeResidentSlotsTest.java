package local.hosting;

import com.google.gson.JsonObject;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class NativeResidentSlotsTest {
    @TempDir Path receipts;

    private static JsonObject request() {
        var row=new JsonObject();
        row.addProperty("characterId","synthetic-resident");
        row.addProperty("ownerId","00000000-0000-4000-8000-000000000001");
        row.addProperty("bodyId","synthetic-maid");
        row.addProperty("entityUuid","00000000-0000-4000-8000-000000000002");
        row.addProperty("operationId","native-switch-1");
        row.addProperty("generation",7);
        row.addProperty("phase","park");
        row.addProperty("kind","maid");
        return row;
    }
    @Test void unknownLookupCreatesNoFileAndDoesNotInferAnAction() throws Exception {
        assertNull(NativeResidentSlots.readOriginal(receipts,null,request()));
        try(var files=Files.list(receipts)) { assertEquals(0L,files.count()); }
    }
    @Test void latestSlotReceiptIsUsableEvenBeforeItHasBeenArchived() throws Exception {
        var request=request();var done=request.deepCopy();done.addProperty("state","committed");
        assertEquals(done,NativeResidentSlots.readOriginal(receipts,done,request));
        var conflicting=request.deepCopy();conflicting.addProperty("generation",8);
        assertThrows(SecurityException.class,()->NativeResidentSlots.readOriginal(receipts,done,conflicting));
    }
    @Test void archivedTerminalsRequireTheExactOriginalBindingAndCannotBeOverwritten() throws Exception {
        var request=request();var done=request.deepCopy();done.addProperty("state","committed");
        NativeResidentSlots.preserveLast(receipts,done);
        NativeResidentSlots.preserveLast(receipts,done);
        assertEquals(done,NativeResidentSlots.readOriginal(receipts,null,request));
        for(String field:new String[]{"characterId","ownerId","entityUuid","bodyId","kind","generation"}) {
            var changed=request.deepCopy(); changed.addProperty(field,"changed");
            assertThrows(SecurityException.class,()->NativeResidentSlots.readOriginal(receipts,null,changed),field);
        }
        var changed=done.deepCopy();changed.addProperty("state","blocked");
        assertThrows(java.io.IOException.class,()->NativeResidentSlots.preserveLast(receipts,changed));
        var resume=request.deepCopy();resume.addProperty("phase","resume");
        assertNull(NativeResidentSlots.readOriginal(receipts,null,resume));
    }
}
