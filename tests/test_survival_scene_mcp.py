"""Actual FastMCP and Qwen formatter preserve the scene PNG as an image."""
import asyncio
import base64
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'world/survival'))
from mcp_server import make_server, TOOL_NAMES


class SceneMcpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from PIL import Image
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        self.server=make_server(SimpleNamespace(state=Path(temp.name),clock=lambda:1800000000))
        out=io.BytesIO();Image.new('RGB',(3,2),(20,90,170)).save(out,format='PNG')
        self.png=out.getvalue()

    async def test_registered_read_only_tool_returns_real_png_block_and_source(self):
        tools=await self.server.list_tools()
        self.assertEqual({t.name for t in tools},set(TOOL_NAMES))
        tool=next(t for t in tools if t.name=='view_scene')
        self.assertEqual(set(tool.inputSchema['properties']),{'radius'})
        frame={'metadata':{'ok':True,'viewType':'native_semantic_map','fov':None},'png':self.png}
        with patch('scene_view.SceneView.capture',return_value=frame) as capture:
            result=await self.server.call_tool('view_scene',{'radius':4})
        capture.assert_called_once_with(4)
        # FastMCP forwards native CallToolResult unchanged.
        blocks=result.content
        self.assertFalse(result.isError)
        self.assertEqual([b.type for b in blocks],['text','image'])
        self.assertEqual(json.loads(blocks[0].text),frame['metadata'])
        self.assertEqual(blocks[1].mimeType,'image/png')
        self.assertEqual(base64.b64decode(blocks[1].data),self.png)

    async def test_failed_observation_never_returns_a_stale_image(self):
        with patch('scene_view.SceneView.capture',return_value={'metadata':{'ok':False,'code':'scene_unavailable'},'png':None}):
            result=await self.server.call_tool('view_scene',{})
        self.assertTrue(result.isError)
        self.assertEqual([b.type for b in result.content],['text'])

    async def test_installed_qwen_promotes_mcp_image_without_losing_tool_identity(self):
        from agentscope.formatter import OpenAIChatFormatter
        from agentscope.message import Msg,TextBlock,ToolCallBlock,ToolResultBlock
        from qwenpaw.agents.model_factory import _create_formatter_instance
        from qwenpaw.drivers.adapters.agentscope_tool import _tool_chunk_from_driver_result
        from qwenpaw.drivers.capabilities import DriverInvocationResult
        from qwenpaw.providers.provider import ModelInfo
        with patch('scene_view.SceneView.capture',return_value={'metadata':{'ok':True,'frameId':'fixture-scene'},'png':self.png}):
            result=await self.server.call_tool('view_scene',{})
        chunk=_tool_chunk_from_driver_result(DriverInvocationResult(ok=True,value=result))
        messages=[Msg(name='user',role='user',content=[TextBlock(text='Inspect this local scene')]),
            Msg(name='qd-survivor',role='assistant',content=[ToolCallBlock(id='scene-call',name='view_scene',input='{}')]),
            Msg(name='qd-survivor',role='assistant',content=[ToolResultBlock(id='scene-call',name='view_scene',output=chunk.content,state='success')])]
        formatter=_create_formatter_instance(SimpleNamespace(formatter=OpenAIChatFormatter()),provider_id='aliyun-codingplan')
        model=ModelInfo(id='qwen3.5-plus',name='qwen3.5-plus',supports_image=True,supports_video=None,supports_multimodal=True)
        with patch('qwenpaw.agents.prompt._get_active_model_info',return_value=(model,model.id)):
            wire=await formatter.format(messages)
        images=[(m,b) for m in wire for b in (m['content'] if isinstance(m.get('content'),list) else []) if b.get('type')=='image_url']
        self.assertEqual(len(images),1)
        self.assertEqual(images[0][0]['role'],'user')
        self.assertEqual(base64.b64decode(images[0][1]['image_url']['url'].split(',',1)[1]),self.png)
        self.assertTrue(any(m['role']=='tool' and m.get('tool_call_id')=='scene-call' for m in wire))
        self.assertIn('fixture-scene',json.dumps(wire))


if __name__=='__main__':unittest.main()
