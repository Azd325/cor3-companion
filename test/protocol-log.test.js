const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const root = join(__dirname, "..");
const src = readFileSync(join(root, "src/helpers/protocol/protocol.js"), "utf8");

function loadProtocol() {
  const window = {
    __cor3: {
      load: () => ({ enabled: true }),
      save() {},
      color: {},
      helper() {},
      every() {},
    },
  };
  window.window = window;
  vm.runInNewContext(src, window, { filename: "protocol.js" });
  return window.__cor3Protocol;
}

function logOf(lines) {
  const divs = lines.map((text) => ({
    textContent: text,
    querySelector() { return null; },
    closest() { return null; },
  }));
  return { querySelectorAll: (sel) => (sel === "div" ? divs : []) };
}

const FIELDS = [
  "Version → v1.0 / v1.1 / v2.0",
  "Method → GET / PUT / POST",
  "Channel → LTE / Fiber / Radio",
  "Cipher → AES / RSA / ECC",
];

const LIVE = [
  ...FIELDS,
  "Attempts: 6 | Time: 120s",
  "> v1.0 GET LTE AES",
  "Mismatched 2",
  "attempts left == 4",
];

test("live log lines keep the submitted guess and shrink the board", () => {
  const { readLog, makeSolver } = loadProtocol();
  const { fields, history, limit } = readLog(logOf(LIVE));
  assert.equal(limit, 6);
  assert.equal(history.length, 1);
  assert.equal(history[0].mismatched, 2);
  assert.equal(history[0].values.join(" "), "v1.0 GET LTE AES");
  assert.equal(fields.length, 4);

  const solver = makeSolver(fields.map((f) => f.length));
  const idx = history[0].values.map((v, f) => fields[f].indexOf(v));
  const guess = solver.combos.findIndex((c) => c.every((v, f) => v === idx[f]));
  const res = solver.solve([{ guess, mismatched: history[0].mismatched }], limit);
  assert.equal(res.cands.length, 24);
  assert.ok(res.cands.length < 81);
});

test("Matched on the next line is a finished guess", () => {
  const { readLog } = loadProtocol();
  const { history, limit } = readLog(logOf([
    "Attempts: 6 | Time: 120s",
    "> v1.0 GET LTE AES",
    "Matched",
    "attempts left == 5",
  ]));
  assert.equal(limit, 6);
  assert.equal(history.length, 1);
  assert.equal(history[0].mismatched, 0);
  assert.equal(history[0].values.join(" "), "v1.0 GET LTE AES");
});

test("old one-line Input and Result still records the guess", () => {
  const { readLog } = loadProtocol();
  const { history, limit } = readLog(logOf([
    ...FIELDS,
    "Attempts: 6 | Time: 120s",
    "Input: v1.0 GET LTE AES Result: Mismatched 2",
  ]));
  assert.equal(limit, 6);
  assert.equal(history.length, 1);
  assert.equal(history[0].mismatched, 2);
  assert.equal(history[0].values.join(" "), "v1.0 GET LTE AES");
});

test("the Input/Result echo of a guess is not a second attempt", () => {
  const { readLog } = loadProtocol();
  const split = readLog(logOf([
    ...FIELDS,
    "Attempts: 3 | Time: 120s",
    "> v1.0 GET LTE AES",
    "Mismatched 3",
    "attempts left == 2",
    "Input: v1.0 GET LTE AES",
    "Result:",
    "Mismatched 3",
    "attempts left == 2",
    "> v1.0 PUT Fiber RSA",
    "Mismatched 1",
    "attempts left == 1",
    "Input: v1.0 PUT Fiber RSA",
    "Result:",
    "Mismatched 1",
    "attempts left == 1",
  ]));
  assert.equal(split.limit, 3);
  assert.equal(JSON.stringify(split.history.map((h) => [h.values.join(" "), h.mismatched])),
    JSON.stringify([["v1.0 GET LTE AES", 3], ["v1.0 PUT Fiber RSA", 1]]));

  const joined = readLog(logOf([
    ...FIELDS,
    "Attempts: 3 | Time: 120s",
    "> v1.0 PUT Fiber RSA",
    "Mismatched 1",
    "attempts left == 2",
    "Input: v1.0 PUT Fiber RSAResult:Mismatched 1attempts left == 2",
  ]));
  assert.equal(joined.history.length, 1);
});

test("a hint is still shown after two guesses out of three", () => {
  const { readLog, makeSolver } = loadProtocol();
  const { fields, history, limit } = readLog(logOf([
    ...FIELDS,
    "Attempts: 3 | Time: 120s",
    "> v1.0 GET LTE AES", "Mismatched 3", "attempts left == 2",
    "Input: v1.0 GET LTE AES", "Result:", "Mismatched 3", "attempts left == 2",
    "> v1.0 PUT Fiber RSA", "Mismatched 1", "attempts left == 1",
    "Input: v1.0 PUT Fiber RSA", "Result:", "Mismatched 1", "attempts left == 1",
  ]));
  const solver = makeSolver(fields.map((f) => f.length));
  const hist = history.map((h) => {
    const idx = h.values.map((v, f) => fields[f].indexOf(v));
    return { guess: solver.combos.findIndex((c) => c.every((v, f) => v === idx[f])), mismatched: h.mismatched };
  });
  const res = solver.solve(hist, limit);
  assert.equal(res.left, 1);
  assert.ok(res.cands.length > 0);
  assert.ok(res.move);
});

test("split Input and Result lines on their own still count once", () => {
  const { readLog } = loadProtocol();
  const { history } = readLog(logOf([
    ...FIELDS,
    "Attempts: 6 | Time: 120s",
    "Input: v1.0 GET LTE AES", "Result:", "Mismatched 2", "attempts left == 5",
  ]));
  assert.equal(history.length, 1);
  assert.equal(history[0].mismatched, 2);
});

test("attempts left comes from the game's own line after the last guess", () => {
  const { readLog } = loadProtocol();
  const base = [...FIELDS, "Attempts: 4 | Time: 120s", "> v1.0 GET LTE AES", "Mismatched 3"];
  assert.equal(readLog(logOf(base)).left, null);
  assert.equal(readLog(logOf([...base, "attempts left == 3"])).left, 3);
});
