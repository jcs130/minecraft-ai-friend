package local.tlmcompat.hybrid;

import local.qdj.maids.brain.MaidBrainControl;

/** Binds the existing controller to the official common-setup extension. */
final class MaidBrainToolGuard implements AutoCloseable {
    private final MaidBrainControl.Registration registration;
    MaidBrainToolGuard(NativeMaidBrainSupport brains){
        registration=MaidBrainControl.bind(brains.boundMaid(),brains.siteIds(),brains::client,brains::mayExecute,brains::carry);
    }
    @Override public void close(){registration.close();}
}
