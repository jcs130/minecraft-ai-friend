import java.lang.invoke.*;
import org.lanternpowered.lmbda.LambdaFactory;

public final class GeyserLambdaLookupTest {
    public static void main(String[] args)throws Throwable {
        var lookup=MethodHandles.publicLookup();
        var abs=lookup.findStatic(Math.class,"abs",MethodType.methodType(int.class,int.class));
        if(LambdaFactory.createIntUnaryOperator(abs).applyAsInt(-7)!=7)throw new AssertionError("primitive static handle");
        var concat=lookup.findVirtual(String.class,"concat",MethodType.methodType(String.class,String.class));
        if(!LambdaFactory.<String>createBinaryOperator(concat).apply("Neo","Forge").equals("NeoForge"))throw new AssertionError("virtual handle");
        var max=lookup.findStatic(Math.class,"max",MethodType.methodType(int.class,int.class,int.class));
        var adapted=MethodHandles.insertArguments(max,0,4);
        if(LambdaFactory.createIntUnaryOperator(adapted).applyAsInt(2)!=4)throw new AssertionError("adapted handle");
        var separator=lookup.findStatic(System.class,"lineSeparator",MethodType.methodType(String.class));
        if(LambdaFactory.<String>createSupplier(separator).get().isEmpty())throw new AssertionError("reference return");
        System.out.println("GeyserLambdaLookupTest: 4 passed");
    }
}
