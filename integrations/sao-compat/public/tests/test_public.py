import importlib.util, json, pathlib, struct, sys, unittest, tempfile
BASE=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(BASE))
from migrate_mixauth import prepared
from bedrock_health import decode_pong,MAGIC
from listener_policy import validate_voice

class PublicDeploymentContract(unittest.TestCase):
 def test_voice_normal_rewrite_is_allowed_but_exposure_changes_are_rejected(self):
  with tempfile.TemporaryDirectory()as directory:
   p=pathlib.Path(directory)/'voice.properties'
   for text in ['port=28989\nbind_address=0.0.0.0\n','#new timestamp\n#new default comment\nport=28989\nbind_address=0.0.0.0\nnew_default=true\n']:
    p.write_text(text);self.assertEqual(validate_voice(p,True)['port'],'28989')
   p.write_text('port=28989\nbind_address=127.0.0.1\n')
   with self.assertRaisesRegex(ValueError,'voice_listener_policy_changed'):validate_voice(p,True)
 def row(self,**kw):return {'USERNAME':'Example','PLAYER_UUID':'12345678-1234-1234-1234-123456789abc','LOGIN_MODE':'OFFLINE','PASSWORD_HASH':'$2b$10$'+'A'*53,**kw}
 def test_registered_password_tag_and_uuid_are_preserved(self):
  row=self.row();value=prepared([row])[0];self.assertEqual(value[0],'example');self.assertEqual(value[1],'maw_mixauth_bcrypt:'+row['PASSWORD_HASH']);self.assertEqual(value[6],row['PLAYER_UUID']);self.assertEqual(value[2],0)
 def test_unregistered_visitors_are_not_reserved(self):self.assertEqual(prepared([self.row(PASSWORD_HASH='')]),[])
 def test_premium_requires_real_online_uuid_without_offline_password(self):
  value=prepared([self.row(LOGIN_MODE='ONLINE',PASSWORD_HASH='')])[0];self.assertEqual(value[2],1);self.assertEqual(value[3],self.row()['PLAYER_UUID']);self.assertEqual(value[1],'premium_only_no_offline_password')
 def test_ambiguous_accounts_are_not_guessed(self):
  with self.assertRaisesRegex(ValueError,'ambiguous_duplicate'):prepared([self.row(),self.row(USERNAME='EXAMPLE')])
  for changed in [{'LOGIN_MODE':'UNKNOWN'},{'PASSWORD_HASH':'plaintext'},{'USERNAME':'x/y'}]:
   with self.assertRaises(ValueError):prepared([self.row(**changed)])
 def test_real_pong_shape_and_challenge(self):
  stamp=1234;text=b'MCPE;My Agent World SAO;2193;26.51;0;20;123;SAO;Survival;1;28988;28988;'
  data=b'\x1c'+struct.pack('>q',stamp)+struct.pack('>q',123)+MAGIC+struct.pack('>H',len(text))+text
  result=decode_pong(data,stamp);self.assertEqual(result['port'],28988);self.assertEqual(result['protocol'],2193)
  for malformed in [data[:-1],data+b'\0',b'\0'+data[1:]]:
   with self.assertRaises(ValueError):decode_pong(malformed,stamp)
  with self.assertRaises(ValueError):decode_pong(data,stamp+1)
if __name__=='__main__':unittest.main()
