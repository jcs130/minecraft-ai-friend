# Count the model request in tokens when a matched counter is available

The configured 32,768-token context is currently enforced using UTF-8 bytes as a
conservative upper bound. In a real Chat request, schemas cost 15,843 bytes,
system rules 6,020, goal 1,068 and current facts 6,235, leaving one tiny tool group.
The adjacent real request used only 9,009 input tokens (6,290 cached). Cache hits
still occupy context and must not be subtracted. This is the shared autonomy
request assembler, not truncation by the thin Neko adapter or the Minecraft body.

Scope: inject a synchronous provider-owned token counter. Preserve the existing
safe fallback for unverified bindings; report its units explicitly. Counter
failure or invalid results rerun the entire assembly in byte mode, never mix
units in intermediate cost/priority calculations. Keep output, image and framing
reserves; keep complete exchanges and current facts at the tail. No fixed paths,
Strata/HF imports, automatic model discovery or arbitrary module import config in
the shared package. Public runner/CLI injection makes the capability usable
without monkeypatching; Neko's dynamically bound SDK aliases retain fallback
until a reliable counter capability exists.

- [x] Add failing token/fallback/injection/budget regressions and implement the port.
- [x] Run complete tests, Ruff, wheel and isolated consumer; ordinary commit/push follows.
- [x] Validate the explicitly matched local CPU adapter against existing wire/usage.
- [x] Consume in plugin 0.5.10, package/deploy and compare actual request retention and gameplay separately.

Private deployment adapter uses the actual Chat wire codec, current server's
normalization, literal handling, effort-tail behavior, template and tokenizer.
45 unambiguous adjacent request/response matches agree exactly with recorded
prompt_tokens. Median CPU count 4.542 ms, max 15.791 ms; zero inference or game
requests. This is a bounded text-only local-model verification, not generic SDK,
multimodal or cross-provider accuracy. Assets/config binding changes invalidate it.
Ignored evidence: adapter local/live-runtime/token-budget-20261014/counter-audit.json.

Additional same-input replay: with eight captured complete tool groups and the
same previously projected facts, byte fallback retains one group at 32,401 upper
bound units (actual input 8,937 tokens). Matched counting retains all eight groups
and every same fact key: input 10,319, output reserve 2,048 and framing 1,024,
total 13,391/32,768. Assembly CPU 197.563 ms. This is an offline constructed
replay from real pairs and already shortened facts, not a claim about an original
untrimmed request or live survival. Both preserve complete tool pairs.

Final shared suite: 342 passed; Ruff and isolated wheel autonomous/queue-only
consumer pass. Wheel SHA256:
2cedb22ef74ae243e9566d577a772101ac2cbf1cc59974dfc3bffd08a37ac14f.

Live 17:33:32–17:37:32 Beijing window: 28 captured requests through its end,
16 with all eight complete groups; all retain 17 fact keys and no omissions.
Original help text is unchanged and retained beside real failures. CPU counts
match recorded prompt_tokens for all 26 unambiguously linked requests; the other
two are not forced into a match. Max input 18,109 plus 3,072 reserve = 21,181.
Audit SHA256 b950317a3984d4f322b36657d719335fbf8fa474ce1bdb905212ec9423cbe082.

The nine-sample natural window shows movement and inventory change (planks,
sticks and one wheat seed), but no food/eating or body recovery: survival remains
not passed. The framework continues running with its native work intact.
