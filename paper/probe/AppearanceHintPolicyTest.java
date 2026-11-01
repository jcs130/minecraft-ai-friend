package org.afuhome.agentfriend;
public final class AppearanceHintPolicyTest {
    public static void main(String[] args) {
        int checks=0;
        for(boolean agent:new boolean[]{false,true})for(boolean observer:new boolean[]{false,true})
        for(boolean seen:new boolean[]{false,true})for(boolean skin:new boolean[]{false,true})
        for(Boolean model:new Boolean[]{null,false,true}){
            boolean expected=agent&&!observer&&!seen&&!skin&&Boolean.FALSE.equals(model);
            if(AppearanceHintPolicy.shouldSuggest(agent,observer,seen,skin,model)!=expected)throw new AssertionError();
            checks++;
        }
        for(String value:new String[]{null,""," ","default","DEFAULT"}){
            if(AppearanceHintPolicy.customModel(value))throw new AssertionError(value);checks++;
        }
        if(!AppearanceHintPolicy.customModel("cormy-winefox-cream"))throw new AssertionError();
        if(!AppearanceHintPolicy.trustedProfile("freesia_worker",null,null,null))throw new AssertionError();checks++;
        String hash="b285c73d4ec010d9a9be3c53c1bee890cf269645be5f1bcf1c27a2e8e82807cb";
        if(!AppearanceHintPolicy.trustedProfile("ysm_native_backend","2.6.5","2.6.0",hash))throw new AssertionError();checks++;
        for(String[] row:new String[][]{{"client","2.6.5","2.6.0",hash},{"ysm_native_backend","2.4.1","2.6.0",hash},{"ysm_native_backend","2.6.5","2.4.0",hash},{"ysm_native_backend","2.6.5","2.6.0","unverified"}}){
            if(AppearanceHintPolicy.trustedProfile(row[0],row[1],row[2],row[3]))throw new AssertionError();checks++;
        }
        System.out.println((checks+1)+" appearance policy checks passed");
    }
}
