package org.afuhome.appearance;
public final class BedrockBuildPolicyTest {
    public static void main(String[] args) {
        if(!BedrockBuildPolicy.supported("1249","git-master-f66329d"))throw new AssertionError("original build");
        if(!BedrockBuildPolicy.supported("1280","git-master-64bb399"))throw new AssertionError("current build");
        if(BedrockBuildPolicy.supported("1280","git-master-f66329d"))throw new AssertionError("crossed build");
        if(BedrockBuildPolicy.supported("1281","git-master-64bb399"))throw new AssertionError("unknown build");
        if(BedrockBuildPolicy.supported(null,null))throw new AssertionError("missing build");
        System.out.println("BedrockBuildPolicyTest: 5 passed");
    }
}
