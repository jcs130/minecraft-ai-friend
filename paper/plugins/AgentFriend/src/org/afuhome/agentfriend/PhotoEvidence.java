package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;

/** Deterministic legibility checks, not an aesthetic model or a client-submitted proof. */
final class PhotoEvidence {
    record Review(boolean qualified, boolean honour, String reason, String advice) { }
    static Review review(JsonObject scene, JsonObject image) {
        if (image == null || !image.has("sha256") || !image.get("sha256").getAsString().matches("[a-f0-9]{64}"))
            return fail("image_unverified", "相机尚未提供成图检验；稍后查看相机状态，联系管理员更新相机服务。");
        if (number(image,"width") < 768 || number(image,"height") < 768)
            return fail("image_too_small", "原始照片分辨率不足；请使用女神相机重新拍摄。");
        if (number(image,"darkFraction") > .85 || number(image,"brightFraction") > .97)
            return fail("image_exposure", "画面几乎全黑或全白；请补充照明、换时间或调整拍摄方向。");
        if (number(image,"contrast") < 6)
            return fail("image_flat", "画面缺少可辨认的景物；向当地建筑或地貌取景，避免只拍天空、墙面或水面。");
        if (scene == null || number(scene,"loadedRays") < 25)
            return fail("scene_unloaded", "取景区域尚未加载；在当地稍等，再面向附近景物拍摄。");
        if (number(scene,"nearRays") > 12)
            return fail("camera_obstructed", "墙壁或近处方块遮住了大半画面；后退几格或更换角度。");
        if (number(scene,"subjectRays") < 5)
            return fail("subject_missing", "当地特色没有进入足够画面；面向正在调查的遗迹或当地地貌，避免只拍天空和脚下。");
        boolean honour=number(scene,"subjectRays")>=10 && number(scene,"depthBands")>=2
                && number(scene,"nearRays")<=2 && number(image,"contrast")>=20 && number(image,"darkFraction")<.35;
        return new Review(true,honour,"qualified",honour
                ?"景物清楚，前后景有层次：获得「摄影·层次分明」纪念荣誉。可写下故事后投稿艺术厅。"
                :"实地照片合格。想让构图更丰富，可选有前景和远景的位置；这不影响考试通过。");
    }
    private static Review fail(String reason,String advice){return new Review(false,false,reason,advice);}
    private static double number(JsonObject j,String key) {
        if(j==null||!j.has(key)||!j.get(key).isJsonPrimitive()||!j.getAsJsonPrimitive(key).isNumber())throw new IllegalArgumentException("photo metric "+key);
        double n=j.get(key).getAsDouble();if(!Double.isFinite(n)||n<0)throw new IllegalArgumentException("photo metric "+key);return n;
    }
    static JsonObject image(JsonObject input) {
        if(input==null)return null;
        JsonObject out=new JsonObject();
        for(String key:List.of("width","height","darkFraction","brightFraction","contrast")) {
            double n=number(input,key),max=key.endsWith("Fraction")?1:key.equals("contrast")?255:4096;
            if(n>max)throw new IllegalArgumentException("photo metric range");out.addProperty(key,n);
        }
        String hash=input.get("sha256").getAsString();if(!hash.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("photo hash");
        out.addProperty("sha256",hash);return out;
    }
    static String text(String raw,int limit) {
        if(raw==null)throw new IllegalArgumentException("请填写文字");
        String clean=raw.strip();
        if(clean.isEmpty()||clean.codePointCount(0,clean.length())>limit||clean.codePoints().anyMatch(c->Character.isISOControl(c)||c==0xa7))
            throw new IllegalArgumentException("请填写1至"+limit+"字的普通文字，不含换行或颜色控制符");
        return clean;
    }
    /** A picture cannot be reused across owners, exam runs or contract stages. */
    static boolean matches(JsonObject row,UUID owner,String exam,String run,int step,long started) {
        if(!row.get("owner").getAsString().equals(owner.toString())||!row.get("qualified").getAsBoolean()
                ||row.get("capturedAt").getAsLong()<started||!row.has("context"))return false;
        JsonObject c=row.getAsJsonObject("context");
        return c.has("examRun")&&c.get("examRun").getAsString().equals(exam)&&c.get("marketRun").getAsString().equals(run)&&c.get("step").getAsInt()==step;
    }
}
