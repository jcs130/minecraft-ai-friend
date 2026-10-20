import pytest

from agent_mc_autonomy.review import ReviewPolicy


def test_short_review_capacity_is_independent_and_explicit():
    assert ReviewPolicy.parse({}).review_max_output_tokens == 3072
    assert ReviewPolicy.parse({'review_max_output_tokens': 1536}).review_max_output_tokens == 1536


@pytest.mark.parametrize('value', [True, 0, 127, 32769, '1536', 1536.5])
def test_invalid_review_capacity_is_rejected(value):
    with pytest.raises(ValueError, match='invalid_integer_range'):
        ReviewPolicy.parse({'review_max_output_tokens': value})
