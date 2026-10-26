"""Typed optional native controls; omission leaves the core's own defaults intact."""

from __future__ import annotations

import copy
import math
import re
from dataclasses import dataclass, field

GROUPS = {
    'combat': {'enabled': bool, 'engageRadius': (1, 16), 'chaseMax': (0, 32), 'maxSec': (1, 120),
               'space': (0.5, 3), 'busyRatio': (1, 100), 'cooldownSec': (0, 600)},
    'reflex': {'fightBack': bool, 'antiDrown': bool, 'antiLava': bool, 'fleeHealth': (1, 40), 'reactCooldownSec': (0, 60)},
    'idle': {'enabled': bool, 'afterArrival': bool, 'allowMovement': bool, 'minIdleMs': (1000, 300000),
             'minIntervalMs': (1000, 300000), 'maxIntervalMs': (1000, 600000)},
    'journey': {'enabled': bool, 'choiceMinBlocks': (1, 64), 'choiceMaxBlocks': (1, 64), 'dangerChoiceMaxBlocks': (1, 32)},
    'show': {'clickMs': (0, 5000), 'dwellOpenMs': (0, 5000), 'dwellResultMs': (0, 5000), 'dwellCloseMs': (0, 5000),
             'reopenGapMs': (0, 5000), 'budgetMs': (0, 30000)},
    'visual': {'background': bool},
}


@dataclass(frozen=True)
class NativeSettings:
    options: dict = field(default_factory=dict)

    @classmethod
    def parse(cls, raw):
        if not isinstance(raw, dict) or set(raw) - {*GROUPS, 'scaffold_blocks', 'remote_textures'}:
            raise ValueError('native_settings_invalid')
        for group, values in raw.items():
            if group == 'scaffold_blocks':
                if (not isinstance(values, list) or len(values) > 32 or not all(isinstance(v, str)
                        and re.fullmatch(r'(?:[a-z0-9_.-]+:)?[a-z0-9_/.-]{1,128}', v) for v in values)):
                    raise ValueError('native_scaffold_blocks_invalid')
                continue
            if group == 'remote_textures':
                if type(values) is not bool:
                    raise ValueError('native_settings_invalid')
                continue
            if not isinstance(values, dict) or set(values) - GROUPS[group].keys():
                raise ValueError('native_settings_invalid')
            for key, value in values.items():
                rule = GROUPS[group][key]
                if rule is bool:
                    valid = type(value) is bool
                else:
                    valid = type(value) in {float, int} and math.isfinite(value) and rule[0] <= value <= rule[1]
                if not valid:
                    raise ValueError('native_settings_invalid')
            for lower, upper in (('choiceMinBlocks', 'choiceMaxBlocks'), ('minIntervalMs', 'maxIntervalMs')):
                if lower in values and upper in values and values[lower] > values[upper]:
                    raise ValueError('native_settings_invalid_range')
        return cls(copy.deepcopy(raw))

    def public_config(self):
        return copy.deepcopy(self.options)

    def client_config(self):
        return {({'scaffold_blocks': 'scaffoldBlocks', 'remote_textures': 'remoteTextures'}.get(key, key)): value
                for key, value in self.public_config().items()}
