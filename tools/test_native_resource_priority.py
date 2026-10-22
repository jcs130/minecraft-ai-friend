import copy,unittest
import native_resource_priority as p

def fixture(name='1.21.1.jar',platform='neoforge-21.1.250-universal.jar'):
    path=next(iter(p.TEXTURES));hashes=p.TEXTURES[path]
    sources=[{'name':name,'sha256':p.CLIENT},{'name':'domum-ornamentum-1.0.231-main.jar','sha256':p.DOMUM},{'name':platform,'sha256':p.PLATFORMS[platform]}]
    entry={'priorityResolution':p.RULE,'source':sources[1]['name'],'sha256':hashes[1],'bytes':123,'variants':[{'source':name,'sha256':hashes[0]},{'source':sources[1]['name'],'sha256':hashes[1],'bytes':123}]}
    return {'clientJarSha256':p.CLIENT,'sources':sources},path,entry

class PriorityTests(unittest.TestCase):
    def test_audited_platforms_accept_original_client_bytes_under_either_filename(self):
        for version in p.PLATFORMS:
            for filename in ('1.21.1.jar','minecraft-1.21.1-client.jar'):
                self.assertTrue(p.verified(*fixture(filename,version)))
    def test_unverified_platform_and_duplicate_source_stay_closed(self):
        for alter in (lambda m:m['sources'][2].update(sha256='0'*64),lambda m:m['sources'].append(copy.deepcopy(m['sources'][0])),lambda m:m['sources'].append({'name':'user.zip','explicitOverride':True})):
            m,k,e=fixture();alter(m);self.assertFalse(p.verified(m,k,e))
    def test_changed_texture_hash_additional_variant_or_missing_audit_stays_closed(self):
        for alter in (lambda e:e['variants'][0].update(sha256='0'*64),lambda e:e['variants'].append({'source':'other.jar'}),lambda e:e.pop('priorityResolution')):
            m,k,e=fixture();alter(e);self.assertFalse(p.verified(m,k,e))
    def test_no_blanket_permission_for_other_minecraft_textures(self):
        m,k,e=fixture();self.assertFalse(p.verified(m,'assets/minecraft/textures/block/stone.png',e))

if __name__=='__main__':unittest.main()
