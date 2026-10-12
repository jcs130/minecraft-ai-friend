import unittest
from maw_bedrock_animations import adapt,safe_clip,POSES

class AnimationTests(unittest.TestCase):
    def test_original_supported_keyframes_and_geometry_bones_are_preserved(self):
        source={'walk':{'animation_length':1,'loop':True,'bones':{'LeftLeg':{'rotation':{'0.0':[20,0,0],'0.5':[-20,0,0]}}}}}
        a=adapt(['LeftLeg','RightLeg','Head'],'test',source)
        self.assertEqual(a['nativeClips'],['walk']);self.assertTrue(a['moving'])
        self.assertEqual(a['clips'][a['ids']['walk']]['bones'],source['walk']['bones'])
        self.assertEqual(a['controller']['controller.animation.maw_native.test']['states']['run']['transitions'][0],{'idle':'query.variant == 0'})

    def test_custom_java_molang_and_unknown_bones_are_not_silently_zeroed(self):
        for clip in [{'bones':{'Head':{'rotation':['v.hv',0,0]}}},
                     {'bones':{'Unknown':{'scale':0}}},
                     {'bones':{'Head':{'rotation':['query.yaw_speed',0,0]}}},
                     {'bones':{'Head':{}},'timeline':{'0.0':'/say unexpected'}}]:
            self.assertIsNone(safe_clip(clip,['Head']))
        a=adapt(['head','legLeft','legRight'],'test',{'walk':{'bones':{'head':{'rotation':['v.by',0,0]}}}})
        self.assertEqual(a['unsupportedNativeClips'],['walk']);self.assertNotIn('walk',a['nativeClips'])

    def test_every_pose_has_a_distinct_controller_and_existing_joint_targets(self):
        names=['head','legLeft','legRight','armLeft','armRight','body','blink']
        a=adapt(names,'test');self.assertEqual(len(a['controller']['controller.animation.maw_native.test']['states']),len(POSES))
        for clip in a['clips'].values():self.assertLessEqual(set(clip['bones']),set(names))
        self.assertTrue(a['moving']);self.assertIn('query.target_x_rotation',str(a['clips'][a['ids']['look']]))
        self.assertNotEqual(a['clips'][a['ids']['idle']],a['clips'][a['ids']['walk']])

if __name__=='__main__':unittest.main()
