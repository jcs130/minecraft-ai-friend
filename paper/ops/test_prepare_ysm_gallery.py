from pathlib import Path
import tempfile,unittest,zipfile,json,hashlib,importlib.util,struct
spec=importlib.util.spec_from_file_location('gallery',Path(__file__).with_name('prepare-ysm-gallery.py'))
gallery=importlib.util.module_from_spec(spec);spec.loader.exec_module(gallery)

class GalleryTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
  self.geometry=json.dumps({'minecraft:geometry':[{'bones':[{'name':'Root','cubes':[]}]}]}).encode()
  self.animation=json.dumps({'animations':{'idle':{'loop':True,'bones':{}}}}).encode()
  self.files={'main.json':self.geometry,'main.animation.json':self.animation,'texture.png':b'\x89PNG\r\n\x1a\n'+b'\0'*8+struct.pack('>II',64,64),'AUTHOR.txt':b'Original author notice','project.bbmodel':b'private editor data','run.exe':b'not a model asset'}
 def tearDown(self):self.temp.cleanup()
 def prepare(self,files=None,sha=None):
  archive=self.root/'source.zip'
  with zipfile.ZipFile(archive,'w')as z:
   for key,data in (files or self.files).items():z.writestr('model/'+key,data)
  row={'id':'qa_model','name':'测试','style':'剑士','sourcePath':'free/source.zip','sourceCommit':'a'*40,'sha256':sha or hashlib.sha256(archive.read_bytes()).hexdigest()}
  return gallery.normalize(row,archive,self.root/'prepared')
 def test_original_runtime_bytes_and_credit_preserved(self):
  report=self.prepare();out=self.root/'prepared'
  self.assertEqual((out/'main.json').read_bytes(),self.geometry);self.assertEqual((out/'main.animation.json').read_bytes(),self.animation)
  self.assertEqual((out/'AUTHOR.txt').read_bytes(),self.files['AUTHOR.txt']);self.assertFalse((out/'run.exe').exists());self.assertFalse((out/'project.bbmodel').exists())
  config=json.loads((out/'ysm.json').read_text(encoding='utf8'));self.assertTrue(config['properties']['free']);self.assertEqual(config['metadata']['license']['type'],'All Rights Reserved');self.assertEqual(report['sourceCommit'],'a'*40)
 def test_hash_mismatch_writes_nothing(self):
  with self.assertRaisesRegex(AssertionError,'hash'):self.prepare(sha='0'*64)
  self.assertFalse((self.root/'prepared').exists())
 def test_traversal_rejected(self):
  with self.assertRaisesRegex(AssertionError,'path'):self.prepare({**self.files,'../../escape.json':b'{}'})
  self.assertFalse((self.root/'escape.json').exists())
 def test_windows_drive_path_rejected(self):
  with self.assertRaisesRegex(AssertionError,'path'):self.prepare({**self.files,'C:/escape.json':b'{}'})
 def test_missing_animation_not_replaced_by_borrowed_clip(self):
  files={k:v for k,v in self.files.items()if k!='main.animation.json'}
  with self.assertRaisesRegex(ValueError,'legacy_animation'):self.prepare(files)
 def test_author_restricted_flag_is_not_overridden(self):
  config={'spec':2,'properties':{'free':False},'files':{'player':{'model':{'main':'main.json'},'animation':{'main':'main.animation.json'},'texture':['texture.png']}}}
  with self.assertRaisesRegex(AssertionError,'not_publicly_selectable'):self.prepare({**self.files,'ysm.json':json.dumps(config).encode()})
 def test_missing_controller_is_rejected(self):
  config={'spec':2,'properties':{'free':True},'files':{'player':{'model':{'main':'main.json'},'animation':{'main':'main.animation.json'},'texture':['texture.png'],'animation_controllers':['missing.json']}}}
  with self.assertRaisesRegex(AssertionError,'missing reference'):self.prepare({**self.files,'ysm.json':json.dumps(config).encode()})
if __name__=='__main__':unittest.main(verbosity=2)
