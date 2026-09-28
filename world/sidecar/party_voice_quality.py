"""Reject obvious machine-like live speech before any game or audio write.

This is deliberately narrow. It does not rewrite a character's words and it
allows urgent help with exact coordinates. Models may try a different line or
stay silent after a definite pre-dispatch rejection.
"""
from difflib import SequenceMatcher
import re


COORDINATES = re.compile(r'\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)')
URGENT = re.compile(r'救命|求救|被困|卡住|掉下去|快来救|危险')
STATUS = (
    re.compile(r'(?<![A-Za-z])day\s*\d+', re.IGNORECASE),
    re.compile(r'(?<![A-Za-z])hp(?![A-Za-z])', re.IGNORECASE),
    re.compile(r'(?<![A-Za-z])y\s*=\s*-?\d+', re.IGNORECASE),
    COORDINATES,
)


def _spoken_shape(text):
    # Values and punctuation change every tick; compare the actual utterance.
    return re.sub(r'[\W\d_]+', '', text.casefold(), flags=re.UNICODE)


def review_spoken_text(text, recent=()):
    """Return a definite pre-dispatch rejection code, or None.

    The caller supplies only recently confirmed speech from this same actor.
    Short warnings and urgent rescue locations remain available.
    """
    if not isinstance(text, str):
        return None  # Existing argument validation owns malformed inputs.
    if URGENT.search(text):
        return None
    if len(text) >= 36:
        shape = _spoken_shape(text)
        for previous in recent:
            if isinstance(previous, str) and len(previous) >= 36:
                other = _spoken_shape(previous)
                if min(len(shape), len(other)) >= 25 and SequenceMatcher(None, shape, other).ratio() >= 0.78:
                    return 'speech_repeats_recent_plan'
    if len(text) >= 55 and sum(bool(pattern.search(text)) for pattern in STATUS) >= 2:
        return 'speech_reads_game_status'
    return None
