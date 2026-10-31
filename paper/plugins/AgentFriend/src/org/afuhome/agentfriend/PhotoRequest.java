package org.afuhome.agentfriend;

import java.util.Arrays;
import java.util.Locale;
import java.util.Set;

/** Existing take syntax plus an optional author-written story; never interprets it as a command. */
record PhotoRequest(String name, String mode, int tiles, String story) {
    static PhotoRequest parse(String[] args, String defaultName) {
        int end=args.length,storyAt=-1;
        for(int i=2;i<args.length;i++)if(args[i].equals("--story")){storyAt=i;end=i;break;}
        if(end>5)throw new IllegalArgumentException("拍照描述放在 --story 后；用法：/mycli photo take <名字> [third|first|top] [1|2] [--story <经历>]");
        String name=end>2?args[2]:defaultName;
        String mode=end>3?args[3].toLowerCase(Locale.ROOT):"first";
        mode=switch(mode){case "第一人称"->"first";case "第三人称"->"third";case "俯视"->"top";default->mode;};
        if(!name.matches("[\\p{L}\\p{N}_-]{1,32}")||!Set.of("first","third","top").contains(mode)
                ||end>4&&!Set.of("1","2").contains(args[4]))throw new IllegalArgumentException("名字限1–32字母、数字、下划线或短横线；视角用third/first/top；尺寸用1或2。用法：/mycli photo take <名字> third 1 --story <经历>");
        String story=storyAt<0?"":PhotoEvidence.text(String.join(" ",Arrays.copyOfRange(args,storyAt+1,args.length)),400);
        return new PhotoRequest(name,mode,end>4?Integer.parseInt(args[4]):1,story);
    }
}
