"""Optional per-request budgets; native reflexes and the existing queue own System 1."""
from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field, replace


@dataclass(frozen=True)
class DecisionSettings:
    enabled: bool = False
    routine_output_tokens: int = 768
    complex_output_tokens: int = 1024
    routine_parameters: dict = field(default_factory=dict)
    complex_parameters: dict = field(default_factory=dict)

    @classmethod
    def parse(cls, raw, maximum):
        if not isinstance(raw, dict) or set(raw) - cls.__dataclass_fields__.keys():
            raise ValueError("decision_policy_invalid")
        value=cls(routine_output_tokens=min(768,maximum),complex_output_tokens=maximum,**{
            key: val for key,val in raw.items() if key not in {"routine_output_tokens","complex_output_tokens"}})
        routine=raw.get("routine_output_tokens",value.routine_output_tokens)
        complex_=raw.get("complex_output_tokens",value.complex_output_tokens)
        if type(value.enabled) is not bool or any(type(n) is not int for n in (routine,complex_)) or not 128 <= routine <= complex_ <= maximum:
            raise ValueError("decision_policy_budget_invalid")
        parameters=[]
        for entry in (value.routine_parameters,value.complex_parameters):
            if not isinstance(entry,dict):
                raise ValueError("decision_policy_parameters_invalid")
            try:
                encoded=json.dumps(entry,allow_nan=False)
            except (ValueError,TypeError,RecursionError):
                raise ValueError("decision_policy_parameters_invalid") from None
            if len(encoded)>8192:
                raise ValueError("decision_policy_parameters_too_large")
            parameters.append(json.loads(encoded))
        return cls(value.enabled,routine,complex_,*parameters)

    def select(self, *, focus=None, failure=False, feedback=False, death=False):
        if not self.enabled:
            return None
        reason=("death_review" if death else "recover_failure" if failure else "new_intent" if feedback
                else "risk_or_missing_facts" if focus in {"survival","inspect"} else "routine_current_goal")
        complex_=reason!="routine_current_goal"
        return {"profile":"complex" if complex_ else "routine","reason":reason,
                "max_output_tokens":self.complex_output_tokens if complex_ else self.routine_output_tokens,
                "parameters":copy.deepcopy(self.complex_parameters if complex_ else self.routine_parameters)}


def profile_view(profile, *, parameters_applied, fallback=None, budget_applied=True, effective_output_tokens=None):
    """No raw parameters or private model configuration in status/stream."""
    return {"profile":profile["profile"],"reason":profile["reason"],
            "requested_max_output_tokens":profile["max_output_tokens"],
            "max_output_tokens":effective_output_tokens if effective_output_tokens is not None else profile["max_output_tokens"],
            "parameters_applied":parameters_applied,"output_budget_applied":budget_applied,"fallback":fallback}


def base_output_budget(config, requested, maximum):
    """Retain a smaller limit only when base parameters fit the same reserve."""
    try:
        config.validate_budget(requested)
    except ValueError:
        # Validate again rather than hiding a genuinely invalid base/reserve.
        config.validate_budget(maximum)
        return maximum
    return requested


def validate_policy(policy, config, maximum):
    from .model_config import validate_parameters
    if policy.enabled:
        for profile in (policy.select(focus='work'),policy.select(failure=True)):
            configured=replace(config,parameters=validate_parameters(config.protocol,{**config.parameters,**profile['parameters']}))
            if profile['max_output_tokens']>maximum:
                raise ValueError('decision_profile_exceeds_reserved_output')
            configured.validate_budget(profile['max_output_tokens'])
