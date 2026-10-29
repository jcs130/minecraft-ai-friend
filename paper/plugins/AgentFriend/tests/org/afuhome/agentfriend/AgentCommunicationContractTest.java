package org.afuhome.agentfriend;
import java.util.*;
public final class AgentCommunicationContractTest {
    static void equal(Object actual,Object expected){if(!Objects.equals(actual,expected))throw new AssertionError(actual+" != "+expected);}
    public static void main(String[]args){
        var local=AgentCommunicationContract.chatPolicy("EssentialsXChat","fixture",48,'!',false,false);
        equal(local.get("defaultChannel"),"nearby");equal(((Map<?,?>)local.get("nearby")).get("radius"),48);
        equal(local.get("mentionsExpandScope"),false);equal(local.get("deliveryAcknowledged"),false);
        equal(AgentCommunicationContract.chatPolicy("EssentialsXChat","fixture",96,'!',false,true).get("defaultChannel"),"unknown");
        equal(AgentCommunicationContract.chatPolicy("EssentialsXChat","fixture",0,'!',false,false).get("defaultChannel"),"server");
        equal(AgentCommunicationContract.chatPolicy("EssentialsXChat","fixture",48,'!',true,false).get("defaultChannel"),"server");
        equal(AgentCommunicationContract.invocation("travel","/mycli waypoint menu").get("kind"),"command");
        equal(AgentCommunicationContract.invocation("give","/mycli cast give <item>").get("kind"),"cast");
        equal(AgentCommunicationContract.castable("food","/mycli cast food_extra"),false);
        System.out.println("Agent communication contract: 9 checks passed");
    }
}
