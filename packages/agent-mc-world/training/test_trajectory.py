import json
from pathlib import Path
import tempfile
import unittest
from mcap.reader import make_reader
from trajectory import TrajectoryWriter, MotorFrame, training_arrays


class TrajectoryTests(unittest.TestCase):
    def test_binary_schema_roundtrip_and_truth_isolation(self):
        contract = {"simulation": "test", "minecraftVersion": "1.21.1", "actionNames": ["idle", "walk"]}
        obs = {"protocol": "agent-mc-motor/v1", "tick": 0, "position": [.5, 64, .5], "velocity": [0, 0, 0],
               "yaw": 0, "onGround": True, "goal": [1, 64, 0], "voxels": [0] * 245}
        truth = {"tick": 0, "goal": [1, 64, 0], "blocks": [{"position": [99, 63, 99], "stateId": 1}]}
        before = {"observation": obs, "features": [1., 2.], "teacher": 1, "truth": truth}
        after = {"observation": {**obs, "tick": 2}, "features": [3., 4.], "reward": .1, "terminal": False, "success": False, "truth": truth}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "samples.mcap"
            with TrajectoryWriter(path, contract) as writer:
                writer.add("walk", 12, "train", before, 1, after)
            with path.open("rb") as stream:
                messages = list(make_reader(stream, validate_crcs=True).iter_messages())
            self.assertEqual(len(messages), 2)
            self.assertEqual(messages[0][0].data[4:8], b"BFBS")
            for schema, channel, message in messages:
                self.assertEqual(schema.encoding, "flatbuffer")
                self.assertTrue(MotorFrame.MotorFrameBufferHasIdentifier(message.data, 0))
                frame = MotorFrame.GetRootAs(message.data, 0)
                if channel.topic == "/motor/environment_truth":
                    self.assertEqual(frame.FeaturesLength(), 0)
                    self.assertEqual(frame.TruthCellsLength(), 4)
                else:
                    self.assertIsNone(frame.Success())
                    self.assertEqual(frame.TruthCellsLength(), 0)
            x, y = training_arrays(path, "train")
            self.assertEqual(x.tolist(), [[1., 2.]])
            self.assertEqual(y.tolist(), [1])
            with self.assertRaisesRegex(ValueError, "split"):
                training_arrays(path, "test")
            with self.assertRaises(FileExistsError):
                TrajectoryWriter(path, contract)


if __name__ == "__main__":
    unittest.main()
