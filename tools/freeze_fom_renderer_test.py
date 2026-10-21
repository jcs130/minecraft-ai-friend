from pathlib import Path
import json,tempfile,unittest
from freeze_fom_renderer import dependency_versions

class DependencyBoundaryTests(unittest.TestCase):
    def test_missing_new_upstream_dependency_is_not_silently_left_out(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'three').mkdir();(root/'three/package.json').write_text(json.dumps({'version':'0.184.0'}))
            with self.assertRaisesRegex(ValueError,'camera-controls'):
                dependency_versions({'dependencies':{'three':'0.184.0','camera-controls':'3.1.2'}},root)

    def test_both_runtime_and_build_versions_are_pinned(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name,version in [('three','0.184.0'),('esbuild','0.28.2')]:
                (root/name).mkdir();(root/name/'package.json').write_text(json.dumps({'version':version}))
            package={'dependencies':{'three':'0.184.0'},'devDependencies':{'esbuild':'0.28.2'}}
            self.assertEqual(set(dependency_versions(package,root)),{'three','esbuild'})
            package['devDependencies']['esbuild']='0.28.3'
            with self.assertRaisesRegex(ValueError,'esbuild'):dependency_versions(package,root)

if __name__=='__main__':unittest.main()
