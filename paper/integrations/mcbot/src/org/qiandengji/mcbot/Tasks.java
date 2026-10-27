package org.qiandengji.mcbot;

import java.util.*;

/** Task identities are single-use within a real connection. */
public final class Tasks {
    public record Flags(boolean readOnly,boolean autonomous) {}
    private final Map<Long,Flags> seen=new HashMap<>();
    public boolean begin(long id,boolean readOnly,boolean autonomous,Long active){
        Flags flags=new Flags(readOnly,autonomous),old=seen.get(id);
        if(old!=null){
            if(Objects.equals(active,id)&&old.equals(flags))return false;
            throw new IllegalArgumentException("STALE_TASK:任务编号已使用或权限不同；旧任务不会重新执行。");
        }
        if(active!=null)throw new IllegalArgumentException("BUSY:先结束当前任务再开始下一条。");
        if(seen.size()>=2048)throw new IllegalArgumentException("会话任务记录已满；请正常重连后开始新任务。");
        seen.put(id,flags);return true;
    }
}
