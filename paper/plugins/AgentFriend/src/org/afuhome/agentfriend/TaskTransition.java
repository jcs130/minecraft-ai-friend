package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;

/** A notification is created only after the calling domain confirms its durable transition. */
final class TaskTransition {
    static JsonObject confirmed(UUID actor,String source,String id,String state,String nextCommand) {
        if(actor==null||!source.matches("[a-z_]{1,32}")||!id.matches("[A-Za-z0-9_:.\\-]{1,100}"))throw new IllegalArgumentException("task_transition_identity");
        String normalized=TaskJournalModel.state(state);
        if(!Set.of("active","ready","complete").contains(normalized))throw new IllegalArgumentException("task_transition_state");
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("kind","task_transition");
        out.addProperty("scope","self");out.addProperty("subjectUuid",actor.toString());out.addProperty("sourceSystem",source);
        out.addProperty("sourceId",id);out.addProperty("state",normalized);out.addProperty("durableConfirmed",true);
        out.addProperty("readOnly",false);out.addProperty("nextCommand",TaskJournalModel.command(nextCommand,"/mycli journal"));return out;
    }
}
