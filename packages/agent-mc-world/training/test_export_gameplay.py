import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import flatbuffers
from mcap.writer import Writer
from export_gameplay import read_reviews, GameplayRecordT
from AgentMcLearning.Assessment import AssessmentT
from AgentMcLearning.Policy import PolicyT

SCOPE = 'a' * 64


def row(source='b' * 64, revision='c' * 64, kind='operation', label='positive', updated='2026-10-18T01:00:00Z', **fields):
    frame = GameplayRecordT()
    values = dict(protocol='agent-mc-gameplay/v1', scopeKey=SCOPE, sourceId=source, id=revision, revision=revision,
                  kind=kind, at=updated, updatedAt=updated, terminal=True, dispatch='returned', phase='completed')
    values.update(fields)
    for key, value in values.items():
        setattr(frame, key, value)
    frame.assessment = AssessmentT()
    frame.assessment.label = label
    frame.assessment.trainingUse = 'progress-review'
    frame.assessment.goalVerified = False
    return frame


def segment(directory, name, rows):
    directory = Path(directory)
    (directory / 'archive-owner.json').write_text(json.dumps({'protocol': 'agent-mc-gameplay/v1', 'scopeKey': SCOPE}), encoding='utf-8')
    path = directory / (name + '.mcap')
    with path.open('wb') as stream:
        writer = Writer(stream, enable_crcs=True)
        writer.start(profile='agent-mc-gameplay/v1')
        schema = writer.register_schema(name='AgentMcLearning.GameplayRecord', encoding='flatbuffer',
                                        data=(Path(__file__).parent.parent / 'src/learning/schema/gameplay.bfbs').read_bytes())
        for frame in rows:
            channel = writer.register_channel(topic={'observation': '/gameplay/observation', 'environment': '/gameplay/environment', 'policy-shadow': '/gameplay/policy-shadow'}.get(frame.kind, '/gameplay/experience'), message_encoding='flatbuffer', schema_id=schema)
            builder = flatbuffers.Builder(1024)
            builder.Finish(frame.Pack(builder), file_identifier=b'MCL1')
            writer.add_message(channel_id=channel, log_time=1, publish_time=1, data=bytes(builder.Output()))
        writer.finish()
    (directory / (name + '.manifest.json')).write_text(json.dumps({'protocol': 'agent-mc-gameplay/v1', 'scopeKey': SCOPE,
        'sealed': True, 'records': len(rows), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}), encoding='utf-8')
    return path


class GameplayExportTests(unittest.TestCase):
    def test_shadow_never_becomes_a_demonstration_or_rule_learning_adoption(self):
        with tempfile.TemporaryDirectory() as directory:
            policy = PolicyT()
            policy.layer, policy.source, policy.mode = 'motor', 'learned', 'shadow'
            policy.policyId, policy.revision = 'motor-test', 'v1'
            segment(directory, 'a', [row(kind='policy-shadow', policy=policy), row(source='e' * 64)])
            rows, metadata = read_reviews(directory)
            self.assertEqual(len(rows), 1)
            self.assertEqual(metadata['counts']['kind:policy-shadow'], 1)
            self.assertEqual(metadata['counts']['policy:unknown'], 1)
            self.assertFalse(metadata['trainingReadiness']['shadowIsTrainingTarget'])

    def test_deduplicates_revisions_by_real_time_and_excludes_partial_control_targets(self):
        with tempfile.TemporaryDirectory() as directory:
            segment(directory, 'a', [row(updated='2026-10-18T09:00:00+08:00'), row(kind='observation'), row(source='e' * 64, dispatch='unknown')])
            segment(directory, 'b', [row(revision='d' * 64, label='mixed', updated='2026-10-18T02:00:00Z')])
            (Path(directory) / 'incomplete.mcap.partial').write_bytes(b'incomplete')
            rows, metadata = read_reviews(directory)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['revision'], 'd' * 64)
            self.assertEqual(rows[0]['assessment']['label'], 'mixed')
            self.assertEqual(rows[0]['split'], 'unassigned')
            self.assertFalse(rows[0]['automaticallyApprovedForTraining'])
            self.assertFalse(metadata['motorImitationReady'])
            self.assertEqual(metadata['partialFilesExcluded'], 1)
            self.assertEqual(metadata['counts']['experienceRevisions'], 3)

    def test_keeps_conflicting_same_time_revisions_out_of_training_review(self):
        with tempfile.TemporaryDirectory() as directory:
            segment(directory, 'a', [row(), row(revision='d' * 64)])
            rows, metadata = read_reviews(directory)
            self.assertEqual(rows, [])
            self.assertEqual(metadata['counts']['conflictingRevisions'], 1)

    def test_preserves_linked_same_time_updates_and_rejects_altered_sealed_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = segment(directory, 'a', [row(), row(revision='d' * 64, previousRevision='c' * 64)])
            rows, _ = read_reviews(directory)
            self.assertEqual(rows[0]['revision'], 'd' * 64)
            with path.open('ab') as stream:
                stream.write(b'corruption')
            with self.assertRaisesRegex(ValueError, 'integrity'):
                read_reviews(directory)


if __name__ == '__main__':
    unittest.main()
