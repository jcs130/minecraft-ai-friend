package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.ai.agent.tool.ToolRegister;
import com.github.tartaricacid.touhoulittlemaid.ai.service.SerializerRegister;
import com.github.tartaricacid.touhoulittlemaid.api.ILittleMaid;
import com.github.tartaricacid.touhoulittlemaid.api.LittleMaidExtension;

@LittleMaidExtension
public final class MaidAgentsHooks implements ILittleMaid {
    @Override public void registerAITool(ToolRegister register) {
        register.register(new MaidEquipTool());
        MaidBrainControl.register(register);
    }

    @Override public void registerAIChatSerializer(SerializerRegister register) {
        MaidBrainControl.registerSites(register);
    }
}
