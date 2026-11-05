package org.qiandeng.camera;
public final class CameraGpuPolicyTest {
    private static void rejects(String profile,String renderer,String vendor) {
        try {CameraGpuPolicy.verify(profile,renderer,vendor);}
        catch(IllegalArgumentException|IllegalStateException expected){return;}
        throw new AssertionError("Unexpected GPU accepted: "+profile+" / "+renderer);
    }
    public static void main(String[] unused) {
        CameraGpuPolicy.verify("intel","D3D12 (Intel(R) UHD Graphics 770)","Microsoft Corporation");
        CameraGpuPolicy.verify("rtx3080ti","NVIDIA GeForce RTX 3080 Ti/PCIe/SSE2","NVIDIA Corporation");
        rejects("intel","NVIDIA GeForce RTX 3080 Ti/PCIe/SSE2","NVIDIA Corporation");
        rejects("rtx3080ti","NVIDIA RTX PRO 5000 72GB Blackwell/PCIe/SSE2","NVIDIA Corporation");
        rejects("rtx3080ti","D3D12 (NVIDIA GeForce RTX 3080 Ti)","Microsoft Corporation");
        rejects("rtx3080ti","NVIDIA GeForce RTX 3080 Ti/PCIe/SSE2","Other");
        rejects("nvidia","NVIDIA GeForce RTX 3080 Ti/PCIe/SSE2","NVIDIA Corporation");
        System.out.println("PASS: 7 GPU policy cases");
    }
}
