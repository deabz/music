const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateCommands } = require("../src/command-validation");
test("all real definitions obey registration limits without contacting Discord", () => {
  assert.deepEqual(validateCommands(require("../src/commands").commands), []);
});
test("registration validator rejects bad order, choices and channel types", () => {
  const option = { type: 3, name: "optional", description: "Description" };
  const errors = validateCommands([{ name: "valid", description: "Description", options: [option,
    { ...option, name: "required", required: true }, { ...option, name: "bad", channel_types: [999], choices: Array(26).fill({ name: "x", value: "x" }) }] }]);
  assert.ok(errors.some(value => value.includes("required option")));
  assert.ok(errors.some(value => value.includes("choices"))); assert.ok(errors.some(value => value.includes("channel types")));
});
