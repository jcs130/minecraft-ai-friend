# Receipt routing regression

`follow`, `stay`, `sit`, `task`, `schedule`, and `pickup` receipts save the full native context in `observation`. Its `conversation` field describes nearby conversation settings as an object. Public chat receipts instead use the string discriminator `conversation: "nearby_visitor"`.

Reading the object with Gson `getAsString()` throws before ordinary receipt reconciliation, and the command handler reports `invalid_request`. The operation may already have succeeded. A failed receipt query is not a reason to repeat its write or change its operation ID.

`visitorReceipt` must require the `chat` action and a string discriminator. Structured context belongs to the ordinary owner-operation path. This does not change ownership checks, receipt files, idempotency, pending-chat recovery, or dialogue privacy.

Run the production classifier against synthetic receipts and a verified Gson 2.10.1 JAR:

```sh
node paper/integrations/touhou-maids/tests/receipt-classification.mjs --gson /path/to/gson-2.10.1.jar --javac /path/to/jdk-21/bin/javac --java /path/to/jdk-21/bin/java
```

The JAR SHA-256 is `4241c14a7727c34feea6507ec801318a3d4a90f070e4525681079fb94ee4c593`. No dependency is downloaded by the test. The runner compiles the actual classifier method from `NativeMaidSocialSupport.java`, not a separately implemented copy. `--source` can point to the previous source to verify that the same regression fails before the fix.

The 32 checks include all six context-bearing actions, native owner chat, visitor chat terminal/pending states, wrong action, and missing or mistyped JSON fields. These isolated checks do not compile the full TLM/Paper plugin or prove a production deployment. Full bridge compilation, isolated-server receipt round trips and restart verification remain release requirements on the server-maintenance side. No live operation should be replayed for this test.
