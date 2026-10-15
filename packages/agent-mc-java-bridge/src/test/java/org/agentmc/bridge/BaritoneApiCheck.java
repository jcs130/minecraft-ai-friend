package org.agentmc.bridge;

/** Discovery checks the actual optional API jar without starting a client or path. */
public final class BaritoneApiCheck {
    public static void main(String[] args)throws Exception{
        boolean expected=args.length==1&&args[0].equals("present");
        if(BaritoneNavigation.available()!=expected)throw new AssertionError("Baritone public API capability mismatch: "+expected+"; "+BaritoneNavigation.diagnostic());
        if(expected){
            Class<?> goalBlock=Class.forName("baritone.api.pathing.goals.GoalBlock"),goalNear=Class.forName("baritone.api.pathing.goals.GoalNear");
            for(int radius:new int[]{0,1,3}){
                Object goal=radius==0?goalBlock.getConstructor(int.class,int.class,int.class).newInstance(-1,64,-2):goalNear.getConstructor(net.minecraft.class_2338.class,int.class).newInstance(new net.minecraft.class_2338(-1,64,-2),radius);
                var isInGoal=goal.getClass().getMethod("isInGoal",int.class,int.class,int.class);var reference=new NavigationSession.Goal(-1,64,-2,radius);
                for(int x=-5;x<=3;x++)for(int y=60;y<=68;y++)for(int z=-6;z<=2;z++)if((boolean)isInGoal.invoke(goal,x,y,z)!=reference.contains(new double[]{x+.5,y,z+.5}))throw new AssertionError("Measured goal differs from actual Baritone goal");
            }
        }
        System.out.println("BaritoneApiCheck: optional public API "+(expected?"detected":"absent without breaking baseline"));
    }
}
