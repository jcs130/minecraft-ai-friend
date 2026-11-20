"""A resident's commitments are observations for its next decision, never executable steps."""
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter


class AgendaSlot(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    afterMinutes: int = Field(ge=0, lt=1440)
    forMinutes: int = Field(ge=1, le=1440)
    goal: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    evidence: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]


def schedule(value: object, now: float) -> list[dict]:
    slots = TypeAdapter(Annotated[list[AgendaSlot], Field(min_length=1, max_length=6)]).validate_python(value)
    end = 0
    result = []
    for slot in slots:
        if slot.afterMinutes < end or slot.afterMinutes + slot.forMinutes > 1440:
            raise ValueError("overlapping_or_out_of_day_agenda")
        end = slot.afterMinutes + slot.forMinutes
        result.append({"startsAt": now + 60 * slot.afterMinutes, "endsAt": now + 60 * end,
                       "goal": slot.goal, "evidence": slot.evidence})
    return result
