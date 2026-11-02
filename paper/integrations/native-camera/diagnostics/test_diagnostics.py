"""Contract tests plus a real -javaagent/JNI-prefix smoke test, without a GPU."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock
from types import SimpleNamespace

from analyze import case, nmt, rows, slope
from build_agent import build
from run_matrix import launch_arguments, properties, validate
import run_matrix
from gallium_summary import summarize as gallium_summary


class DiagnosticsTests(unittest.TestCase):
    def test_properties_restore_preserves_unknown_settings(self):
        original = b"# lab\r\nenableShaders=false\r\nshaderPack=old.zip\r\notherSetting=keep\r\n"
        changed = properties(original, True, "new.zip")
        self.assertIn(b"otherSetting=keep", changed)
        self.assertEqual(changed.count(b"enableShaders="), 1)
        self.assertIn(b"enableShaders=true", changed)
        self.assertIn(b"shaderPack=new.zip", changed)

    def test_lab_rejects_production_autojoin_and_tokens(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); game=root/"game"; game.mkdir()
            (game/"memory-lab.json").write_text(json.dumps({"schema":"qiandeng-camera-memory-lab/v1","isolated":True,"loopbackOnly":True}))
            base=["-cp","lab.jar","Main","--gameDir",str(game),"--assetsDir",str(game/"assets"),"--accessToken","0"]
            self.assertEqual(validate(game,{"arguments":base},root/"new-out",29090),base)
            for extra in (["--quickPlayMultiplayer","example.com:25565"],["--quickPlayMultiplayer=example.com:25565"],["-javaagent:other.jar"],["-XX:NativeMemoryTracking=off"]):
                with self.assertRaises(ValueError): validate(game,{"arguments":base+extra},root/"new-out",29090)
            bad=base.copy(); bad[-1]="private-token"
            with self.assertRaises(ValueError): validate(game,{"arguments":bad},root/"new-out",29090)
            with self.assertRaises(ValueError): validate(game,{"arguments":base},game/"logs",29090)
            (game/"memory-lab.json").unlink()
            with self.assertRaises(FileNotFoundError): validate(game,{"arguments":base},root/"new-out",None)

    def test_launch_changes_only_qa_child(self):
        with tempfile.TemporaryDirectory() as tmp:
            game=Path(tmp)
            base=["-Xms512M","-Xmx2G","-cp","lab.jar","Main"]
            args=launch_arguments(base,game/"agent.jar",game/"out",1536,29090,game)
            self.assertIn("-Xmx1536M",args); self.assertNotIn("-Xmx2G",args)
            self.assertEqual(args[-2:],["--quickPlayMultiplayer","127.0.0.1:29090"])
            self.assertEqual(base,["-Xms512M","-Xmx2G","-cp","lab.jar","Main"])
            micro=launch_arguments(base,game/"agent.jar",game/"out",1536,29090,game,"depth-copy")
            self.assertNotIn("--quickPlayMultiplayer",micro)
            self.assertNotIn("Main",micro)
            self.assertEqual(micro[-1],"org.qiandeng.diagnostics.GlRepro")

    def test_gallium_destroy_and_partial_crash_tail(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"trace.xml"
            prefix='''<trace><call class="pipe_screen" method="resource_create"><ret><ptr>0x100</ptr></ret></call>
                <call class="pipe_screen" method="resource_destroy"><arg name="resource"><ptr>0x100</ptr></arg></call>
                <call class="pipe_screen" method="resource_create"><ret><ptr>0x200</ptr></ret></call>'''
            path.write_text(prefix+"</trace>")
            result=gallium_summary(path)
            self.assertEqual(result["resourceCreates"],2)
            self.assertEqual(result["resourceDestroyCalls"],1)
            self.assertEqual(result["outstandingObservedPointers"],1)
            self.assertFalse(result["partialXml"])
            path.write_text(prefix+'<call method="resource_create"><arg')
            result=gallium_summary(path)
            self.assertTrue(result["partialXml"])
            self.assertEqual(result["resourceCreates"],2)
            self.assertEqual(result["outstandingObservedPointers"],1)

    def test_job_assignment_failure_stops_only_spawned_child(self):
        with tempfile.TemporaryDirectory() as tmp:
            game=Path(tmp)/"game";game.mkdir();(game/"shaderpacks").mkdir();(game/"shaderpacks/x.zip").write_bytes(b"fixture")
            agent=Path(tmp)/"agent.jar";agent.write_bytes(b"fixture")
            (Path(tmp)/"camera-memory-probe.jar").write_bytes(b"fixture")
            child=mock.Mock(pid=456,returncode=1);child.poll.return_value=None
            windows=mock.Mock();windows.host.return_value={"hostFreeCommit":100*1024**3};windows.contain.side_effect=OSError("nested job denied")
            args=SimpleNamespace(seconds=45,process_limit_gib=6,heap_mib=1536,shader="x.zip",min_host_free_gib=8,fixture_port=None)
            with mock.patch.dict(os.environ,{},clear=True),mock.patch.object(run_matrix.subprocess,"CREATE_NO_WINDOW",0,create=True),mock.patch.object(run_matrix.subprocess,"Popen",return_value=child) as spawn:
                with self.assertRaises(OSError):
                    run_matrix.run_case(args,windows,game,game/"java.exe",agent,["Main"],Path(tmp)/"evidence",False,None)
            self.assertEqual(spawn.call_count,1)
            child.terminate.assert_called_once(); child.wait.assert_called_once()
            windows.contain.assert_called_once_with(child,6*1024**3)
            self.assertFalse(json.loads((Path(tmp)/"evidence/run.json").read_text())["verified"])

    def test_matrix_restores_original_bytes_on_failed_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);game=root/"lab";game.mkdir();(game/"config").mkdir();(game/"shaderpacks").mkdir()
            original=b"# original\r\nenableShaders=false\r\nshaderPack=old.zip\r\n"
            (game/"config/iris.properties").write_bytes(original);(game/"shaderpacks/x.zip").write_bytes(b"fixture")
            java=root/"java.exe";java.touch();(root/"jcmd.exe").touch();agent=root/"agent.jar";agent.touch()
            (root/"camera-memory-probe.jar").touch()
            (game/"memory-lab.json").write_text(json.dumps({"schema":"qiandeng-camera-memory-lab/v1","isolated":True,"loopbackOnly":True}))
            (game/"launch.json").write_text(json.dumps({"arguments":["Main","--gameDir",str(game),"--assetsDir",str(game/"assets"),"--accessToken","0"]}))
            argv=["run_matrix.py","--game",str(game),"--java",str(java),"--agent",str(agent),"--out",str(root/"evidence"),"--shader","x.zip"]
            with mock.patch("sys.argv",argv),mock.patch.object(run_matrix,"Windows"),mock.patch.object(run_matrix,"run_case",side_effect=RuntimeError("guard")):
                with self.assertRaises(RuntimeError): run_matrix.main()
            self.assertEqual((game/"config/iris.properties").read_bytes(),original)
            self.assertTrue(json.loads((root/"evidence/restoration.json").read_text())["irisPropertiesRestored"])

    def test_nmt_and_slope_distinguish_missing_from_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"nmt.txt"; path.write_text("Total: reserved=999KB +20KB, committed=123KB +5KB\n")
            self.assertEqual(nmt(path),123*1024)
            path.write_text("Native memory tracking is not enabled")
            self.assertIsNone(nmt(path))
            path.write_text('{"value":1}\n{"incomplete"')
            self.assertEqual(rows(path),[{"value":1}])
        self.assertIsNone(slope([],"privateBytes"))
        points=[{"atMs":1_800_000_000_000+i*1000,"privateBytes":100+i*512} for i in range(6)]
        self.assertEqual(slope(points,"privateBytes"),512)

    def test_analyzer_never_passes_missing_gl_or_wrong_pid(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/"run.json").write_text(json.dumps({"mode":"shader-on","pid":123}))
            (root/"process.jsonl").write_text(json.dumps({"atMs":0,"pid":999,"privateBytes":100})+"\n")
            result=case(root)
            self.assertFalse(result["verified"])
            self.assertEqual(result["cause"],"unconfirmed")
            self.assertIsNone(result["privatePeakBytes"])
            self.assertGreaterEqual(len(result["warnings"]),4)

    def test_world_phase_ignores_menu_transition_and_uses_fresh_world_frames(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/"run.json").write_text(json.dumps({"mode":"shader-on","pid":123}))
            data=[]
            for i in range(20):
                data.append({"atMs":i*1000,"pid":123,"frames":i*30,"worldFrames":max(0,(i-3))*30,
                    "shadersEnabled":i>=4,"renderer":"D3D12 Intel fixture","heapUsed":100,
                    "api":{"net.irisshaders.iris.pipeline.IrisRenderingPipeline.<init>":1},"coverage":{"org/lwjgl/opengl/GL11C":5}})
            (root/"jvm-gl.jsonl").write_text("\n".join(map(json.dumps,data)))
            (root/"process.jsonl").write_text("\n".join(json.dumps({"atMs":i*1000,"pid":123,"privateBytes":1000+i*10}) for i in range(20)))
            result=case(root)
            self.assertEqual(result["activeRenderWindowStartsAtMs"],4000)
            self.assertEqual(result["renderWarmupMs"],14000)
            self.assertEqual(result["observedShaderStates"],[True])
            self.assertFalse(any("shader state" in warning for warning in result["warnings"]))
            self.assertEqual(result["processPrivateSlopeBytesPerSecond"],10)

    def test_real_transformer_preserves_values_buffers_exceptions_and_native_calls(self):
        java=shutil.which("java")
        if not java: self.skipTest("JDK unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); jar=build(java,root/"agent-build"); output=root/"output"; output.mkdir()
            sources={
                "org/lwjgl/opengl/GL11C.java": '''package org.lwjgl.opengl;
                    import java.nio.*;
                    public class GL11C {
                        public static int glGenTextures(){return 11;}
                        public static int glGenTextures(boolean fail){if(fail)throw new IllegalArgumentException();return 12;}
                        public static void glGenTextures(IntBuffer ids){ids.put(ids.position(),22);}
                        public static void glDeleteTextures(int id){}
                        public static void glDeleteTextures(IntBuffer ids){}
                        public static void glTexImage2D(int a,int b,int c,int d,int e,int f,int g,int h,long i){}
                        public static void glDrawArrays(int mode,int first,int count){}
                        public static String glGetString(int name){return "D3D12 Intel fixture (not actual rendering)";}
                    }''',
                "org/lwjgl/opengl/GL15C.java": '''package org.lwjgl.opengl; import java.nio.*;
                    public class GL15C {
                        public static void glBufferData(int target,long size,int usage){}
                        public static void glBufferSubData(int target,long offset,ByteBuffer data){}
                    }''',
                "org/lwjgl/opengl/GL32C.java": '''package org.lwjgl.opengl;
                    public class GL32C {
                        public static long glFenceSync(int a,int b){return 123456789012L;}
                        public static void glDeleteSync(long id){}
                    }''',
                "org/lwjgl/opengl/GL20C.java": '''package org.lwjgl.opengl;
                    public class GL20C {
                        static { System.load(System.getProperty("fixture.native")); }
                        public static native int glCreateProgram();
                        public static native void glDeleteProgram(int program);
                    }''',
                "org/lwjgl/glfw/GLFW.java": '''package org.lwjgl.glfw;
                    public class GLFW {public static void glfwMakeContextCurrent(long context){} public static void glfwSwapBuffers(long window){}}''',
                "net/irisshaders/iris/targets/RenderTargets.java": '''package net.irisshaders.iris.targets;
                    public class RenderTargets { public boolean resizeIfNeeded(boolean changed){return changed;} }''',
                "net/irisshaders/iris/pipeline/IrisRenderingPipeline.java": '''package net.irisshaders.iris.pipeline;
                    public class IrisRenderingPipeline { public final int x; public IrisRenderingPipeline(int x){this.x=x;} public void destroy(){} public void beginLevelRendering(){} }''',
                "net/irisshaders/iris/api/v0/IrisApi.java": '''package net.irisshaders.iris.api.v0;
                    public class IrisApi {public static IrisApi getInstance(){return new IrisApi();} public boolean isShaderPackInUse(){return false;}}''',
                "Main.java": '''import org.lwjgl.opengl.*; import org.lwjgl.glfw.GLFW; import java.nio.*;
                    public class Main {public static void main(String[] args) throws Exception {
                        GLFW.glfwMakeContextCurrent(99);
                        if(GL11C.glGenTextures()!=11)throw new AssertionError(); GL11C.glDeleteTextures(11);
                        IntBuffer ids=IntBuffer.allocate(3); ids.position(1); ids.limit(2);
                        GL11C.glGenTextures(ids); if(ids.get(1)!=22 || ids.position()!=1)throw new AssertionError();
                        GL11C.glDeleteTextures(ids);
                        try{GL11C.glGenTextures(true);throw new AssertionError();}catch(IllegalArgumentException expected){}
                        GL15C.glBufferData(1,4096L,2); GL15C.glBufferSubData(1,8192L,ByteBuffer.allocateDirect(16));
                        long sync=GL32C.glFenceSync(0,0); if(sync!=123456789012L)throw new AssertionError();GL32C.glDeleteSync(sync);
                        if(args.length>0){int program=GL20C.glCreateProgram();if(program!=77)throw new AssertionError();GL20C.glDeleteProgram(program);}
                        ClassLoader child=new java.net.URLClassLoader(new java.net.URL[]{java.nio.file.Path.of(System.getProperty("fixture.iris")).toUri().toURL()},Main.class.getClassLoader());
                        Class<?> pipelineType=Class.forName("net.irisshaders.iris.pipeline.IrisRenderingPipeline",true,child);
                        Object pipeline=pipelineType.getConstructor(int.class).newInstance(123);
                        for(int i=0;i<3;i++)pipelineType.getMethod("beginLevelRendering").invoke(pipeline);
                        if(pipelineType.getField("x").getInt(pipeline)!=123)throw new AssertionError();pipelineType.getMethod("destroy").invoke(pipeline);
                        Class<?> targetType=Class.forName("net.irisshaders.iris.targets.RenderTargets",true,child);
                        Object targets=targetType.getConstructor().newInstance();var resize=targetType.getMethod("resizeIfNeeded",boolean.class);
                        if((Boolean)resize.invoke(targets,false)||!(Boolean)resize.invoke(targets,true))throw new AssertionError();
                        for(int i=0;i<30;i++){GL11C.glDrawArrays(4,0,3);GLFW.glfwSwapBuffers(1);}
                        Thread.sleep(2300);
                    }}'''
            }
            paths=[]
            for name,text in sources.items():
                path=root/"src"/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text);paths.append(str(path))
            classes=root/"classes";classes.mkdir()
            subprocess.run([java,"com.sun.tools.javac.Main","-d",str(classes),*paths],check=True,capture_output=True)
            child_classes=root/"iris-classes";child_classes.mkdir();shutil.move(str(classes/"net"),str(child_classes/"net"))
            native=[]
            if os.name=="posix" and shutil.which("gcc"):
                source=root/"native.c"
                source.write_text("int Java_org_lwjgl_opengl_GL20C_glCreateProgram(void* env,void* cls){return 77;}\nvoid Java_org_lwjgl_opengl_GL20C_glDeleteProgram(void* env,void* cls,int value){}\n")
                library=root/"fixture.so"
                subprocess.run(["gcc","-shared","-fPIC",str(source),"-o",str(library)],check=True,capture_output=True)
                native=[f"-Dfixture.native={library}"]
            process=subprocess.run([java,*native,f"-Dfixture.iris={child_classes}",f"-javaagent:{jar}={output}","-cp",str(classes),"Main",*(["native"] if native else [])],capture_output=True,text=True,timeout=15)
            self.assertEqual(process.returncode,0,process.stdout+process.stderr)
            samples=rows(output/"jvm-gl.jsonl"); last=samples[-1]; api=last["api"]
            self.assertIn("org.lwjgl.opengl.GL11C.glGenTextures",api,json.dumps(last)+process.stderr)
            self.assertEqual(api["org.lwjgl.opengl.GL11C.glGenTextures"],2) # thrown call not recorded
            self.assertEqual(api["textures:namesGenerated"],2)
            self.assertEqual(api["textures:deleteRequests"],2)
            self.assertEqual(api["org.lwjgl.opengl.GL15C.glBufferData:requestedBytes"],4096)
            self.assertEqual(api["org.lwjgl.opengl.GL15C.glBufferSubData:requestedBytes"],16) # offset is not size
            self.assertEqual(api["org.lwjgl.opengl.GL11C.glDrawArrays"],30)
            self.assertEqual(api["net.irisshaders.iris.targets.RenderTargets.resizeIfNeeded:true"],1)
            self.assertEqual(last["frames"],30)
            self.assertEqual(last["worldFrames"],3)
            self.assertFalse(last["shadersEnabled"])
            self.assertEqual(last["observerErrors"],0)
            self.assertTrue(all(count==0 for count in last["trackedNames"].values()))
            if native:
                self.assertEqual(api["program:namesGenerated"],1)
                self.assertEqual(api["program:deleteRequests"],1)


if __name__=="__main__": unittest.main()
