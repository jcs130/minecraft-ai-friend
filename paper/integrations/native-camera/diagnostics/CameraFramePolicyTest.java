import org.qiandeng.camera.CameraFramePolicy;
public class CameraFramePolicyTest {
    public static void main(String[] args) {
        check(120, false,"rtx3080ti",false,120);
        check(120, true,"intel",false,120);
        check(120, true,"other",true,120);
        check(5, true,"rtx3080ti",false,120);
        check(30, true,"rtx3080ti",true,120);
        check(2, true,"rtx3080ti",false,2);
        check(15, true,"rtx3080ti",true,15);
        System.out.println("7 frame-budget cases passed");
    }
    static void check(int want, boolean enabled, String gpu, boolean capture, int original) {
        int actual=CameraFramePolicy.limit(enabled,gpu,capture,original);
        if(actual!=want)throw new AssertionError(actual+" != "+want);
    }
}
