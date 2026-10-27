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
        System.out.println((checks+1)+" appearance policy checks passed");
    }
}
