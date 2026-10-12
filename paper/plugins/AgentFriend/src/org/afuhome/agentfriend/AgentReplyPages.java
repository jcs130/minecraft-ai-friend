package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;

/** Bounded, lossless chat pages. A large row is JSON-fragmented, never shortened. */
final class AgentReplyPages {
    static final int BODY_LIMIT = 1200;
    record Page(JsonArray items, int firstItem, int lastItem) { }
    static List<Page> pack(List<JsonObject> rows) {
        if (rows.stream().mapToInt(r -> r.toString().length()).sum() > 131072)
            throw new IllegalArgumentException("response_too_large");
        List<Page> pages = new ArrayList<>(); JsonArray current = new JsonArray(); int first = 0, last = 0;
        for (int index = 0; index < rows.size(); index++) {
            String json = rows.get(index).toString();
            if (json.length() > 900) {
                if (!current.isEmpty()) { pages.add(new Page(current, first, last)); current = new JsonArray(); }
                List<String> chunks = chunks(json, 600);
                JsonObject summary=new JsonObject();summary.addProperty("encoding","summary");summary.addProperty("itemIndex",index);
                summary.addProperty("detailParts",chunks.size());summary.addProperty("detailEncoding","json_fragment");
                for(String key:List.of("id","section","kind","title","stage","stageTitle","status","graduated","completed","nextCommand")) {
                    JsonElement value=rows.get(index).get(key);
                    if(value!=null&&value.isJsonPrimitive()&&value.toString().length()<=160
                            &&summary.toString().length()+key.length()+value.toString().length()+5<=BODY_LIMIT)summary.add(key,value.deepCopy());
                }
                JsonArray overview=new JsonArray();overview.add(summary);pages.add(new Page(overview,index,index));
                for (int part = 0; part < chunks.size(); part++) {
                    JsonObject fragment = new JsonObject(); fragment.addProperty("encoding", "json_fragment");
                    fragment.addProperty("itemIndex", index); fragment.addProperty("part", part + 1);
                    fragment.addProperty("parts", chunks.size()); fragment.addProperty("data", chunks.get(part));
                    JsonArray items = new JsonArray(); items.add(fragment); pages.add(new Page(items, index, index));
                }
                continue;
            }
            if (!current.isEmpty() && (current.size() >= 4 || current.toString().length() + json.length() + 1 > BODY_LIMIT)) {
                pages.add(new Page(current, first, last)); current = new JsonArray();
            }
            if (current.isEmpty()) first = index;
            current.add(rows.get(index).deepCopy()); last = index;
        }
        if (!current.isEmpty()) pages.add(new Page(current, first, last));
        if (pages.isEmpty()) pages.add(new Page(new JsonArray(), 0, -1));
        return List.copyOf(pages);
    }
    static List<String> chunks(String text, int size) {
        if (size < 2) throw new IllegalArgumentException("chunk size");
        List<String> result = new ArrayList<>();
        for (int start = 0; start < text.length();) {
            int end = Math.min(text.length(), start + size);
            if (end < text.length() && Character.isHighSurrogate(text.charAt(end - 1))
                    && Character.isLowSurrogate(text.charAt(end))) end--;
            result.add(text.substring(start, end)); start = end;
        }
        return result;
    }
}
