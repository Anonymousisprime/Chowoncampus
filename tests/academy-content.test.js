const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const academy = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "academy-data.json"), "utf8"));
const roles = ["student", "restaurant", "agent"];

test("Academy has six role-specific lessons and ten FAQs for every user role", () => {
  for (const role of roles) {
    assert.equal(academy.lessons.filter(item => item.role === role).length, 6, role + " lesson count");
    assert.equal(academy.faqs.filter(item => item.role === role).length, 10, role + " FAQ count");
    assert.ok(academy.lessons.filter(item => item.role === role).every(item => item.published === true));
    assert.ok(academy.faqs.filter(item => item.role === role).every(item => item.published === true));
  }
});

test("Academy content identifiers are unique", () => {
  const ids = [...academy.lessons, ...academy.faqs].map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("Each role has a complete three-question knowledge check", () => {
  for (const role of roles) {
    const quiz = academy.quizzes[role];
    assert.equal(quiz.length, 3, role + " quiz count");
    for (const question of quiz) {
      assert.ok(question.id);
      assert.ok(question.question);
      assert.ok(Array.isArray(question.choices) && question.choices.length >= 2);
      assert.ok(Number.isInteger(question.answer));
      assert.ok(question.answer >= 0 && question.answer < question.choices.length);
    }
  }
});
