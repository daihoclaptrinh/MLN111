const test = require("node:test");
const assert = require("node:assert/strict");

const { checkAnswer } = require("../src/services/answerChecker");

test("checks multiple choice answers by option letter", () => {
  const result = checkAnswer(
    {
      type: "multiple_choice",
      points: 1,
      correctOption: "B",
      options: [{ label: "B", text: "Thuc tai khach quan" }],
      explanation: "Vi vat chat ton tai khach quan.",
    },
    "b",
  );

  assert.equal(result.autoGradable, true);
  assert.equal(result.correct, true);
  assert.equal(result.points, 1);
});

test("marks essay answers as requiring review", () => {
  const result = checkAnswer(
    {
      type: "essay",
      points: 2,
      options: [],
      suggestedAnswer: "Giai thich theo y chinh.",
    },
    "cau tra loi",
  );

  assert.equal(result.autoGradable, false);
  assert.equal(result.correct, null);
  assert.equal(result.points, 2);
});
