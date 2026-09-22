import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('decider_model_config', ROOT/'patches/decider/model_config.py')
resolver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resolver)


class DeciderConfigTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)/'snapshots'/('a'*40);self.root.mkdir(parents=True)
        self.config = {'version':'v10','temperature':1.3,'temperature_schema_first':1.18,
                       'neutralize_none':False,'schema_first':False,'schema_first_trained':True,'isolated_levels':True}
        self.write()

    def write(self):
        (self.root/'decider_config.json').write_text(json.dumps(self.config),encoding='utf8')

    def test_hub_weights_and_config_use_the_same_resolved_snapshot(self):
        download=Mock(return_value=str(self.root))
        path,cfg,meta=resolver.load_model_config('Mapika/decider-2b',{'DECIDER_REVISION':'a'*40},download)
        self.assertEqual(Path(path),self.root)
        self.assertEqual(download.call_args.kwargs['revision'],'a'*40)
        self.assertEqual(meta['revision'],'a'*40)
        self.assertEqual(meta['modelName'],'decider-v10')
        self.assertEqual(meta['temperature'],1.3)
        self.assertIs(cfg['neutralize_none'],False);self.assertIs(cfg['isolated_levels'],True)
        self.assertEqual(len(meta['configSha256']),64)

    def test_local_model_never_downloads_or_silently_falls_back(self):
        download=Mock(side_effect=AssertionError('unexpected network'))
        resolver.load_model_config(str(self.root),{},download)
        (self.root/'decider_config.json').unlink()
        with self.assertRaises(FileNotFoundError):resolver.load_model_config(str(self.root),{},download)
        download.assert_not_called()

    def test_malformed_calibration_flags_or_version_fail_before_engine_loading(self):
        for key,value in [('temperature',0),('temperature',True),('temperature',float('nan')),
                          ('temperature_schema_first',-1),('version',None),('isolated_levels','false')]:
            with self.subTest(key=key,value=value):
                original=dict(self.config);self.config[key]=value;self.write()
                with self.assertRaises(ValueError):resolver.load_model_config(str(self.root),{})
                self.config=original
        self.write()
        for value in ('nan','inf','0','-1'):
            with self.assertRaises(ValueError):resolver.load_model_config(str(self.root),{'DECIDER_TEMPERATURE':value})
        _,_,meta=resolver.load_model_config(str(self.root),{'DECIDER_TEMPERATURE':'1.1'})
        self.assertEqual(meta['temperature'],1.1);self.assertIs(meta['temperatureOverridden'],True)
