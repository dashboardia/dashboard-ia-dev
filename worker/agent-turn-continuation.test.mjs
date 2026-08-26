import assert from "node:assert/strict";
import test from "node:test";

import { maxTurnSegmentsForPolicy } from "./agent-turn-continuation.mjs";

test("reparo pode desativar continuações que repetem todo o prompt", () => {
  assert.equal(maxTurnSegmentsForPolicy({ scope: "COMPLEX", powerMode: "MAXIMUM", maxSegments: 1 }), 1);
});
