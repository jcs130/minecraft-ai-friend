package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.api.ILittleMaid;
import com.github.tartaricacid.touhoulittlemaid.api.LittleMaidExtension;
import com.github.tartaricacid.touhoulittlemaid.ai.agent.tool.ToolRegister;
import com.github.tartaricacid.touhoulittlemaid.ai.service.SerializerRegister;
import net.neoforged.fml.common.Mod;

@Mod("qiandengji_maid_brain")
@LittleMaidExtension
public final class MaidBrainExtension implements ILittleMaid {
    public MaidBrainExtension(){}
    @Override public void registerAITool(ToolRegister register){MaidBrainControl.register(register);}
    @Override public void registerAIChatSerializer(SerializerRegister register){MaidBrainControl.registerSites(register);}
}
