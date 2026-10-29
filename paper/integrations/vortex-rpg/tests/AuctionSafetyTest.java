import org.qiandengji.vortex.AuctionSafety;
public final class AuctionSafetyTest {
    public static void main(String[]args){int n=0;
        for(String root:new String[]{"auction","ah","vortexrpg:auction","AUCTION"}){if(!AuctionSafety.blocked(root,new String[]{"sell","5"}))throw new AssertionError(root);n++;}
        for(String root:new String[]{"vrp","vortex","vortexrpg","vortexrpg:vrp"}){if(!AuctionSafety.blocked(root,new String[]{"auction","sell","5"}))throw new AssertionError(root);n++;}
        for(String[] row:new String[][]{{"vortex","class"},{"vrp","quest"},{"class","choose"},{"mycli","trade"}}){if(AuctionSafety.blocked(row[0],new String[]{row[1]}))throw new AssertionError(row[0]);n++;}
        if(!AuctionSafety.MESSAGE.contains("未扣款")||!AuctionSafety.MESSAGE.contains("trade wallet"))throw new AssertionError("explicit nonexecution and recovery");n++;
        System.out.println("auction-safety="+n);
    }
}
