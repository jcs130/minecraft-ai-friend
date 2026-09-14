"""Scoped official MakeSkill shell commands; no alternative skill runtime."""
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
import native_make_skill_policy as policy
import native_role_capabilities as native


class MakeSkillBoundary(unittest.TestCase):
    def test_exact_role_command_and_no_shell_composition(self):
        pattern = policy.command_pattern('qd-survivor')
        valid = 'python -B scripts/create_plan.py --input /state/work/workspaces/qd-survivor/notes/plan.json'
        self.assertIsNotNone(re.fullmatch(pattern, valid))
        for bad in (valid+'; true', valid+'\ntrue', valid+' > /tmp/a', valid.replace('qd-survivor','mc-god'),
                    valid.replace('create_plan','arbitrary'), valid.replace('notes/plan','../secret'),
                    valid.replace('python ','python -c '), valid.replace(' -B',''), valid.replace('notes/plan','notes/$(whoami)')):
            self.assertIsNone(re.fullmatch(pattern,bad),bad)

    def test_same_workspace_input_and_symlink_boundaries(self):
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary).resolve() / 'workspace'
            workspace.mkdir()
            path=workspace/'plan.json'; path.write_text('{"name":"camp-review"}',encoding='utf-8')
            self.assertEqual(policy._file(path,workspace)['name'],'camp-review')
            with self.assertRaises(ValueError): policy._file(path,workspace/'other')
            path.write_text('[]',encoding='utf-8')
            with self.assertRaises(ValueError): policy._file(path,workspace)
            path.write_bytes(b'x'*131073)
            with self.assertRaises(ValueError): policy._file(path,workspace)

    def test_reserved_skill_namespace_stays_protected(self):
        policy._name({'name':'camp-review'})
        for name in ('qd-bypass','make-skill','file_reader','cron','../bad','UPPER','x y'):
            with self.subTest(name=name),self.assertRaises(ValueError): policy._name({'name':name})

    def test_new_guard_allows_official_commands_but_protects_plan(self):
        with patch.object(native,'package_version',return_value='2.2.1'):
            rules=native.rules('qd-survivor')
        rule=next(row for row in rules if row['id']=='QD_NATIVE_CRON_SCOPE')
        good='python -B scripts/init_draft.py --input /state/work/workspaces/qd-survivor/notes/input.json'
        self.assertFalse(any(re.search(pattern,good) for pattern in rule['patterns']))
        self.assertTrue(any(re.search(pattern,good+' && touch /tmp/bad') for pattern in rule['patterns']))
        plan=next(row for row in rules if row['id']=='QD_NATIVE_MAKE_SKILL_PLAN')
        self.assertTrue(any(re.search(pattern,'.qwenpaw/make-skill/drafts/'+'a'*24+'/plan.json') for pattern in plan['patterns']))

    def test_new_version_has_complete_pinned_official_packages(self):
        lock=native.native_lock('2.2.1')
        self.assertEqual(set(lock['skills']),set(native.NATIVE_SKILLS))
        self.assertEqual(len(lock['skills']['make-skill']['files']),8)
        self.assertEqual(set(policy.STAGES),{Path(name).stem for name in lock['skills']['make-skill']['files'] if name.startswith('scripts/')})

    def test_scanner_retains_block_and_exact_official_exception_only(self):
        configured=native.configure_native_scanner({'mode':'block','whitelist':[]},version='2.2.1')
        self.assertEqual(configured['mode'],'block')
        self.assertEqual(configured['whitelist'],[{'skill_name':'make-skill','content_hash':native.native_lock('2.2.1')['skills']['make-skill']['scannerContentSha256']}])
        with self.assertRaises(ValueError): native.configure_native_scanner({'whitelist':[{'skill_name':'make-skill','content_hash':''}]},version='2.2.1')
        self.assertEqual(native.configure_native_scanner(configured,version='2.2.1'),configured)


@unittest.skipUnless(os.name=='posix' and os.environ.get('QD_MAKE_SKILL_QA')=='1'
    and native.package_version()=='2.2.1', 'Explicit disposable 2.2.1 container only')
class InstalledOfficialMakeSkill(unittest.TestCase):
    def test_official_scripts_preserve_native_guards_and_publish_to_own_workspace(self):
        import asyncio
        from qwenpaw.constant import WORKING_DIR
        from qwenpaw.config.config import Config, AgentProfileConfig
        from qwenpaw.config.context import set_current_workspace_dir
        from qwenpaw.agents.tools.shell import execute_shell_command
        from qwenpaw.agents.tools.file_io import write_file
        from qwenpaw.governance.resource_governor import ResourceGovernor
        from qwenpaw.governance.tool_adapter import PolicyGuardedTool
        from qwenpaw.runtime.tool_guard import GuardedFunctionTool
        from qwenpaw.agents.skill_system.workspace_service import SkillService
        from agentscope.permission import PermissionBehavior
        from native_skill_sync import sync_native_skill, sync_native_pool
        import native_tool_runtime
        self.assertEqual(str(WORKING_DIR),'/state/work')
        self.assertFalse((WORKING_DIR/'config.json').exists(), 'Never run against existing state')
        WORKING_DIR.mkdir(parents=True,exist_ok=True)
        config=Config(security={'skill_scanner':native.configure_native_scanner({})})
        (WORKING_DIR/'config.json').write_text(config.model_dump_json())
        role='qd-survivor'; workspace=WORKING_DIR/'workspaces'/role; workspace.mkdir(parents=True)
        profile=AgentProfileConfig(id=role,name='Disposable skill QA',workspace_dir=str(workspace)).model_dump(mode='json')
        profile=native.configure_native(profile,role)
        (workspace/'agent.json').write_text(json.dumps(profile))
        service=SkillService(workspace)
        original_profile=(workspace/'agent.json').read_bytes()
        legacy=Path(os.environ['QD_LEGACY_SKILLS']) if os.environ.get('QD_LEGACY_SKILLS') else None
        if legacy:
            pool=WORKING_DIR/'skill_pool'; pool.mkdir(exist_ok=True)
            pool_manifest={'schema_version':'skill-pool-manifest.v1','version':1,'skills':{},'builtin_skill_names':[]}
            for name in native.NATIVE_SKILLS:
                body=(legacy/name/'SKILL.md').read_text(encoding='utf-8')
                self.assertEqual(service.create_skill(name,body,enable=True,source='builtin',config={'qa':'preserved'}),name)
                directory=pool/name; directory.mkdir(exist_ok=True)
                (directory/'SKILL.md').write_text(body,encoding='utf-8')
                pool_manifest['skills'][name]={'name':name,'source':'builtin','builtin_language':'zh','builtin_source_name':name+'-zh',
                    'config':{'qa':'preserved'},'auto_update':False,'auto_sync':False}
            (pool/'skill.json').write_text(json.dumps(pool_manifest))
        pool_result=sync_native_pool(WORKING_DIR,WORKING_DIR/'backup')
        expected_changed={'make-skill'} if legacy else set(native.NATIVE_SKILLS)
        self.assertEqual(set(pool_result['changed']),expected_changed)
        for name in native.NATIVE_SKILLS:
            self.assertEqual(native.directory_hashes(WORKING_DIR/'skill_pool'/name),native.native_lock('2.2.1')['skills'][name]['files'])
        self.assertEqual(sync_native_pool(WORKING_DIR,WORKING_DIR/'backup-second')['changed'],[])
        for name in native.NATIVE_SKILLS:
            sync_native_skill(service,workspace,name,WORKING_DIR/'backup')
        installed=json.loads((workspace/'skill.json').read_text())['skills']
        self.assertEqual(native.validate_native_skills(workspace,installed),3)
        self.assertEqual((workspace/'agent.json').read_bytes(),original_profile)
        if legacy:
            for name in native.NATIVE_SKILLS:
                self.assertEqual(installed[name]['config'],{'qa':'preserved'})
                if name in expected_changed:
                    self.assertEqual((WORKING_DIR/'backup'/role/'native-packages'/name/'package/SKILL.md').read_bytes(),(legacy/name/'SKILL.md').read_bytes())
                    self.assertEqual((WORKING_DIR/'backup/native-pool'/name/'SKILL.md').read_bytes(),(legacy/name/'SKILL.md').read_bytes())
        protected=workspace/'skills/cron/SKILL.md'; protected_original=protected.read_bytes()
        try:
            protected.write_bytes(protected_original+b'\nUser addition\n')
            with self.assertRaisesRegex(ValueError,'user_modified_native_skill'):
                sync_native_skill(service,workspace,'cron',WORKING_DIR/'backup-user-edit')
            self.assertEqual(protected.read_bytes(),protected_original+b'\nUser addition\n')
        finally: protected.write_bytes(protected_original)
        pool_protected=WORKING_DIR/'skill_pool/cron/SKILL.md'; pool_original=pool_protected.read_bytes()
        try:
            pool_protected.write_bytes(pool_original+b'\nUser addition\n')
            with self.assertRaisesRegex(ValueError,'user_modified_native_pool_skill'):
                sync_native_pool(WORKING_DIR,WORKING_DIR/'backup-pool-user-edit')
            self.assertEqual(pool_protected.read_bytes(),pool_original+b'\nUser addition\n')
        finally: pool_protected.write_bytes(pool_original)
        native_tool_runtime.install('game')
        set_current_workspace_dir(workspace)
        governor=ResourceGovernor(str(workspace)); governor.start()
        request={'agent_id':role,'session_id':'make-skill-qa','approval_level':'AUTO',
                 'root_agent_id':role, '_spawn_subagent':True,
                 'subagent_allowed_tools':['read_file','write_file','execute_shell_command']}
        directory=workspace/'skills/make-skill'
        def tool(func,kind='policy'):
            return PolicyGuardedTool(func,governor=governor,request_context=request) if kind=='policy' else GuardedFunctionTool(func,agent_id=role,request_context=request)
        def extract(chunk):
            value=chunk.model_dump(mode='json') if hasattr(chunk,'model_dump') else chunk
            text='\n'.join(x.get('text','') for x in value['content'])
            start=text.find('{'); end=text.rfind('}')
            output=json.loads(text[start:end+1])
            if 'stdout' in output: return json.loads(output['stdout'])
            return output
        async def execute(stage,payload):
            file=workspace/'notes'/f'{stage}.json'
            await write_file(file_path=str(file),content=json.dumps(payload))
            arguments={'command':f'python -B scripts/{stage}.py --input {file}','cwd':str(directory)}
            for kind in ('policy','legacy'):
                decision=await tool(execute_shell_command,kind).check_permissions(arguments)
                self.assertEqual(decision.behavior,PermissionBehavior.ALLOW,(kind,decision))
            result=extract(await execute_shell_command(**arguments))
            self.assertTrue(result.get('ok'),result)
            return result
        async def main():
            plan={'revision':1,'focus':'Record a repeatable camp review','name':'camp-review','goal':'Check actual inventory evidence',
                  'type':'instruction','batch':False,'steps':['Read actual inventory evidence and retain unknown outcomes.'],
                  'package':['SKILL.md'],'execution':'foreground','test':{'mode':'off','target':''},'warnings':[]}
            normalized=(await execute('create_plan',plan))['plan']
            draft=await execute('init_draft',{'workspace':str(workspace),'plan':normalized})
            draft_id=draft['draft_id']
            skill_dir=Path(draft['skill_dir'])
            await write_file(file_path=str(skill_dir/'SKILL.md'),content='---\nname: camp-review\ndescription: Review actual camp inventory evidence.\n---\n\nRead current inventory evidence. Keep unknown outcomes separate from successful actions.\n')
            validation=await execute('validate_skill',{'workspace':str(workspace),'draft_id':draft_id})
            await execute('publish_skill',{'workspace':str(workspace),'draft_id':draft_id,'expected_digest':validation['digest']})
            self.assertTrue((workspace/'skills/camp-review/SKILL.md').is_file())
            self.assertTrue(json.loads((workspace/'skill.json').read_text())['skills']['camp-review']['enabled'])
            self.assertFalse((WORKING_DIR/'workspaces/mc-god').exists())
            for kind in ('policy','legacy'):
                wrong={'command':f'python -B scripts/init_draft.py --input {workspace}/notes/init_draft.json','cwd':str(directory)}
                (workspace/'notes/init_draft.json').write_text(json.dumps({'workspace':'/state/work/workspaces/mc-god','plan':normalized}))
                decision=await tool(execute_shell_command,kind).check_permissions(wrong)
                self.assertEqual(decision.behavior,PermissionBehavior.DENY,(kind,decision))
                decision=await tool(write_file,kind).check_permissions({'file_path':str(directory/'scripts/create_plan.py'),'content':'tampered'})
                self.assertEqual(decision.behavior,PermissionBehavior.DENY)
                (workspace/'notes/init_draft.json').write_text(json.dumps({'workspace':str(workspace),'plan':normalized}))
                for bad in ({**wrong,'cwd':str(workspace)}, {**wrong,'command':wrong['command']+'; true'},
                            {**wrong,'command':wrong['command'].replace(' -B','')},
                            {**wrong,'command':wrong['command'].replace('qd-survivor','mc-god')},
                            {**wrong,'command':wrong['command'].replace('init_draft.py','arbitrary.py')}):
                    decision=await tool(execute_shell_command,kind).check_permissions(bad)
                    self.assertEqual(decision.behavior,PermissionBehavior.DENY,(kind,bad,decision))
                (workspace/'notes/init_draft.json').write_text(json.dumps({'workspace':str(workspace),'plan':{**normalized,'name':'qd-bypass'}}))
                decision=await tool(execute_shell_command,kind).check_permissions(wrong)
                self.assertEqual(decision.behavior,PermissionBehavior.DENY)
                (workspace/'notes/init_draft.json').write_text(json.dumps({'workspace':str(workspace),'plan':normalized}))
                original=(directory/'scripts/create_plan.py').read_bytes()
                try:
                    (directory/'scripts/create_plan.py').write_bytes(original+b'\n# tamper\n')
                    decision=await tool(execute_shell_command,kind).check_permissions(wrong)
                    self.assertEqual(decision.behavior,PermissionBehavior.DENY)
                finally: (directory/'scripts/create_plan.py').write_bytes(original)
            self.assertFalse(list(directory.rglob('*.pyc')))
            from qwenpaw.security.skill_scanner import is_skill_whitelisted
            self.assertTrue(is_skill_whitelisted('make-skill',directory,cfg=config.security.skill_scanner))
            self.assertFalse(is_skill_whitelisted('camp-review',workspace/'skills/camp-review',cfg=config.security.skill_scanner))
            discovered={skill.name for skill in service.list_available_skills()}
            self.assertIn('camp-review',discovered)
            output=os.environ.get('QD_MAKE_SKILL_REPORT')
            if output:
                Path(output).write_text(json.dumps({'ok':True,'qwenVersion':native.package_version(),
                    'stages':list(policy.STAGES),'officialSkills':list(native.NATIVE_SKILLS),'poolMigrated':pool_result,
                    'originalProfileUnchanged':(workspace/'agent.json').read_bytes()==original_profile,
                    'legacyPackageBackupsVerified':bool(legacy),'nativeScannerMode':config.security.skill_scanner.mode,
                    'makeSkillContentHash':native.native_lock('2.2.1')['skills']['make-skill']['scannerContentSha256'],
                    'publishedSkill':'camp-review','nativeDiscovered':sorted(discovered),'permissionWrappers':['policy','legacy'],
                    'crossRoleAndShellCompositionDenied':True,'nativePackageHasNoBytecode':not list(directory.rglob('*.pyc')),
                    'modelsCalled':0,'network':'none','productionStateMounted':False},ensure_ascii=False,indent=2),encoding='utf-8')
        try: asyncio.run(main())
        finally: set_current_workspace_dir(None)


if __name__=='__main__': unittest.main()
