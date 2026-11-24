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
