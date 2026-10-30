# Action results and subsequent speech

The executor does not infer the meaning of arbitrary chat. A chat step without
`needs` remains independent of a failed delivery, navigation or crafting step.
Use the existing explicit dependency contract when speech relies on an earlier
action in the same batch:

```json
[
  {"skill":"toss","item":"coal","count":4,"target":"Friend"},
  {"skill":"chat","text":"已尝试交付，请核对掉落物。","needs":[1]},
  {"skill":"chat","text":"我在核对附近的路线。","needs":[]}
]
```

If step 1 fails, step 2 is skipped and step 3 may still run. The executor must not
silently add dependencies to every chat or suppress unrelated conversation.
Indices refer to this batch only and start at 1.

Explicit dependencies permit upstream `ok` and `partial`; they are not proof
that a requested quantity was fully delivered. To report quantities, inspect
the actual per-step result before composing that report. Scripts can await
`mc.do`, inspect `result.steps` (`outcome`, `why`, `detail`) and branch on those
results. A finished script or `done` flag does not prove the recipient collected
the item. Inventory loss, throwing an item, and another player's matching
pickup event are different evidence. An unverified delivery must not be replayed
merely because a player says it was received.

The flat skill schema, opt-in per-skill chat schema and on-demand chat help
explain this same contract. This is planning guidance and an offline regression
fixture, not a claim that a deployed model will always generate dependencies.
The regression uses a real 1.21.1 executor with local fixtures only: an unseen
recipient and a recipient closer than two blocks both prevent throwing, skip
the dependent claim, and retain unrelated speech. No game connection, model
call or item consumption is used for acceptance.
