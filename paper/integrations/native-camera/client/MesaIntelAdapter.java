package org.qiandeng.camera;

import com.sun.jna.Callback;
import com.sun.jna.CallbackReference;
import com.sun.jna.Function;
import com.sun.jna.Memory;
import com.sun.jna.Native;
import com.sun.jna.NativeLibrary;
import com.sun.jna.Pointer;
import com.sun.jna.ptr.PointerByReference;
import com.sun.jna.win32.StdCallLibrary;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Locale;

/** Select the adapter in the camera's own pinned Mesa instance, before WGL
 * creates a context. Mesa's Windows DXGI path does not use the DXCore/WSLg
 * MESA_D3D12_DEFAULT_ADAPTER_NAME setting. No system driver or display is edited. */
public final class MesaIntelAdapter {
    private static final String MESA_SHA256="ff543fd582df39a2df0356d98396a463a9de974cf926b8173a57060627212e6d";
    private static NativeLibrary mesa;
    private static Memory callbacks;
    private static AdapterCallback callback;
    private static boolean installed;
    private MesaIntelAdapter() { }

    public interface AdapterCallback extends StdCallLibrary.StdCallCallback {
        void invoke(Pointer hdc, Pointer outputLuid);
    }

    public static synchronized void installIfRequested() {
        if(!Boolean.getBoolean("qiandeng.camera.enabled")
                ||!Boolean.getBoolean("qiandeng.camera.mesaIntelAdapter")||installed)return;
        if(Native.POINTER_SIZE!=8||!System.getProperty("os.name","").startsWith("Windows"))
            throw new IllegalStateException("CAMERA_MESA_PLATFORM_UNSUPPORTED");
        try {
            Path dll=Path.of(System.getProperty("java.home"),"bin","libgallium_wgl.dll").toRealPath();
            String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(dll)));
            if(!hash.equals(MESA_SHA256))throw new IllegalStateException("CAMERA_MESA_RUNTIME_UNREVIEWED");
            long[] luid=findIntelAdapter();
            mesa=NativeLibrary.getInstance(dll.toString());
            callback=(hdc,output)->{output.setInt(0,(int)luid[0]);output.setInt(4,(int)luid[1]);};
            // WGLCALLBACKS slot 5 is PFN_GETADAPTERLUID(HDC,LUID*).
            // This app-local Mesa instance has no OS ICD callbacks installed.
            callbacks=new Memory(6L*Native.POINTER_SIZE);callbacks.clear();
            callbacks.setPointer(5L*Native.POINTER_SIZE,CallbackReference.getFunctionPointer(callback));
            mesa.getFunction("DrvSetCallbackProcs",Function.ALT_CONVENTION).invokeVoid(new Object[]{6,callbacks});
            installed=true;
        }catch(RuntimeException failure){throw failure;}
        catch(Exception failure){throw new IllegalStateException("CAMERA_MESA_ADAPTER_SELECTION_FAILED",failure);}
    }

    private static Function method(Pointer object,int slot){
        return Function.getFunction(object.getPointer(0).getPointer((long)slot*Native.POINTER_SIZE),Function.ALT_CONVENTION);
    }
    private static void release(Pointer object){if(object!=null)method(object,2).invokeInt(new Object[]{object});}

    private static long[] findIntelAdapter(){
        NativeLibrary dxgi=NativeLibrary.getInstance(Path.of(System.getenv("SystemRoot"),"System32","dxgi.dll").toString());
        Memory iid=new Memory(16);iid.clear();
        iid.setInt(0,0x770aae78);iid.setShort(4,(short)0xf26f);iid.setShort(6,(short)0x4dba);
        iid.write(8,new byte[]{(byte)0xa8,0x29,0x25,0x3c,(byte)0x83,(byte)0xd1,(byte)0xb3,(byte)0x87},0,8);
        PointerByReference out=new PointerByReference();
        int hr=dxgi.getFunction("CreateDXGIFactory1",Function.ALT_CONVENTION).invokeInt(new Object[]{iid,out});
        if(hr!=0||out.getValue()==null)throw new IllegalStateException("CAMERA_DXGI_ENUMERATION_FAILED");
        Pointer factory=out.getValue();
        try{
            for(int index=0;index<16;index++){
                PointerByReference candidate=new PointerByReference();
                int result=method(factory,12).invokeInt(new Object[]{factory,index,candidate});
                if(result==0x887A0002)break; // DXGI_ERROR_NOT_FOUND
                if(result!=0||candidate.getValue()==null)throw new IllegalStateException("CAMERA_DXGI_ADAPTER_READ_FAILED");
                Pointer adapter=candidate.getValue();
                try{
                    // DXGI_ADAPTER_DESC1 layout on Windows x64 (WCHAR[128],
                    // 4 UINTs, 3 SIZE_Ts, LUID, flags; sizeof=312).
                    Memory desc=new Memory(312);desc.clear();
                    if(method(adapter,10).invokeInt(new Object[]{adapter,desc})!=0)
                        throw new IllegalStateException("CAMERA_DXGI_DESCRIPTION_FAILED");
                    String name=desc.getWideString(0);
                    if(desc.getInt(256)==0x8086&&(desc.getInt(304)&2)==0&&name.toLowerCase(Locale.ROOT).contains("intel")){
                        long low=Integer.toUnsignedLong(desc.getInt(296));int high=desc.getInt(300);
                        if(low==0&&high==0)throw new IllegalStateException("CAMERA_INTEL_ADAPTER_ID_MISSING");
                        System.out.println("[QiandengCamera] Selected physical Intel adapter: "+name);
                        return new long[]{low,high};
                    }
                }finally{release(adapter);}
            }
        }finally{release(factory);}
        throw new IllegalStateException("CAMERA_INTEL_ADAPTER_MISSING");
    }
}
