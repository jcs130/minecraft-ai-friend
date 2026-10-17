"""MCAP FlatBuffers records with observed inputs and isolated simulator truth topics."""
from pathlib import Path
import json
import sys
import time
import flatbuffers
import numpy as np
from mcap.reader import make_reader
from mcap.writer import Writer, CompressionType

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "generated"))
from AgentMcMotor.MotorFrame import MotorFrame, MotorFrameT


def encode(frame):
    builder = flatbuffers.Builder(4096)
    builder.Finish(frame.Pack(builder), file_identifier=b"MCM1")
    return bytes(builder.Output())


class TrajectoryWriter:
    def __init__(self, path, contract):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.output = path.open("xb")
        self.writer = Writer(self.output, compression=CompressionType.ZSTD, enable_crcs=True, enable_data_crcs=True)
        self.writer.start(profile="agent-mc-motor/v1", library="agent-mc-world motor training")
        schema = self.writer.register_schema(name="AgentMcMotor.MotorFrame", encoding="flatbuffer", data=(ROOT / "schema/motor.bfbs").read_bytes())
        metadata = {"simulation": contract["simulation"], "minecraft_version": contract["minecraftVersion"],
                    "tick_ns": "50000000", "action_ticks": "2", "log_time": "Unix wall-clock nanoseconds",
                    "tick_source": "stepped client physics ticks; server continues at wall time" if contract.get("backend") == "minecraft" else "offline physics ticks",
                    "observation_source": contract.get("observationSource", "generated local voxel/state fixture; not rendered camera perception"),
                    "backend": contract.get("backend", "offline"), "goal_mode": contract.get("goalMode", "teacher-waypoint"),
                    "actions": json.dumps(contract["actionNames"])}
        self.observation = self.writer.register_channel(topic="/motor/observation_action", message_encoding="flatbuffer", schema_id=schema, metadata=metadata)
        self.truth = self.writer.register_channel(topic="/motor/environment_truth", message_encoding="flatbuffer", schema_id=schema,
                                                  metadata={**metadata, "training_input": "forbidden"})
        self.count = 0
        self.scenes = {}

    def write(self, channel, frame):
        now = time.time_ns()
        self.writer.add_message(channel_id=channel, log_time=now, publish_time=now, data=encode(frame))

    def truth_frame(self, task, seed, split, truth, episode=None):
        episode = episode or f"{split}/{task}/{seed}"
        cells = [int(value) for cell in truth["blocks"] for value in (*cell["position"], cell["stateId"])]
        snapshot = (cells, truth["goal"], truth.get("serverPosition"), truth.get("serverGoalConfirmed"))
        if self.scenes.get(episode) == snapshot:
            return
        self.scenes[episode] = snapshot
        frame = MotorFrameT(protocol="agent-mc-motor/v1", episodeId=episode, task=task, seed=seed, split=split,
                            tick=truth["tick"], simTimeNs=truth["tick"] * 50_000_000, kind=1,
                            goal=truth["goal"], truthCells=cells, serverPosition=truth.get("serverPosition"),
                            serverClientDistance=truth.get("serverClientDistance"), serverGoalConfirmed=truth.get("serverGoalConfirmed"))
        self.write(self.truth, frame)

    def add(self, task, seed, split, before, action, after):
        o = before["observation"]
        episode = f"{split}/{before['episodeId']}" if before.get("episodeId") else f"{split}/{task}/{seed}"
        if before.get("truth"):
            self.truth_frame(task, seed, split, before["truth"], episode)
        if after.get("truth"):
            # A real server position changes even while static map cells remain identical.
            self.truth_frame(task, seed, split, after["truth"], episode)
        n = after["observation"]
        frame = MotorFrameT(protocol=o["protocol"], episodeId=episode, task=task, seed=seed, split=split,
                            tick=o["tick"], simTimeNs=o["tick"] * 50_000_000, kind=0, position=o["position"],
                            velocity=o["velocity"], yaw=o["yaw"], onGround=o["onGround"], goal=o["goal"],
                            gridShape=[7, 5, 7], voxels=o["voxels"], features=before["features"],
                            actionIndex=action, teacherIndex=before.get("teacher") if before.get("teacher") is not None else -1,
                            reward=after["reward"], terminal=after["terminal"], success=after["success"] if after["terminal"] else None,
                            failure=after.get("failure"), nextFeatures=after["features"], nextPosition=n["position"],
                            nextVelocity=n["velocity"], nextYaw=n["yaw"], nextOnGround=n["onGround"], nextVoxels=n["voxels"],
                            expertIntervention=before.get("executedByTeacher"), goalMode=o.get("goalMode"), nextGoal=n["goal"],
                            proposedActionIndex=before.get("policyProposal", -1),
                            terminated=after["terminal"] and after.get("failure") != "timeout",
                            truncated=after.get("failure") == "timeout")
        self.write(self.observation, frame)
        self.count += 1

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.writer.finish()
        self.output.close()


def training_arrays(path, split, goal_mode=None):
    features, actions = [], []
    with Path(path).open("rb") as stream:
        for schema, channel, message in make_reader(stream, validate_crcs=True).iter_messages(topics=["/motor/observation_action"]):
            if schema.encoding != "flatbuffer" or channel.message_encoding != "flatbuffer" or not MotorFrame.MotorFrameBufferHasIdentifier(message.data, 0):
                raise ValueError("Unexpected trajectory encoding")
            frame = MotorFrame.GetRootAs(message.data, 0)
            if frame.Split().decode() != split or frame.Kind() != 0 or frame.TruthCellsLength() or frame.ServerPositionLength():
                raise ValueError("Trajectory split or truth isolation violation")
            if goal_mode and ((frame.GoalMode().decode() if frame.GoalMode() else "teacher-waypoint") != goal_mode
                              or channel.metadata.get("goal_mode", "teacher-waypoint") != goal_mode):
                raise ValueError("Trajectory goal mode differs from its manifest")
            if frame.TeacherIndex() < 0:
                continue
            features.append(frame.FeaturesAsNumpy())
            actions.append(frame.TeacherIndex())
    if not features:
        raise ValueError("No labelled motor observations")
    x, y = np.stack(features).astype(np.float32), np.asarray(actions, dtype=np.int64)
    if not np.isfinite(x).all():
        raise ValueError("Non-finite training observation")
    return x, y
