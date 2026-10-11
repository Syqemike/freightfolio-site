import { describe, it } from "node:test";
import assert from "node:assert/strict";
describe("docsUsed", () => {
  it("counts only recorded files, ignoring stale pending reservations", async () => {
    const { docsUsed } = await import("../lib/customer.js");
    const order = {
      files: [{ sha256: "a" }],
      pending: Array.from({ length: 10 }, () => ({ sha256: "b", key: "k", reserved_at: "2020-01-01T00:00:00Z" })),
    };
    assert.equal(docsUsed(order), 1);
    assert.equal(docsUsed(null), 0);
    assert.equal(docsUsed({}), 0);
  });
});
