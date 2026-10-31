// publisher.setExchangeMapping is runtime behaviour consumers rely on: account-service and
// profile-service register the payment-link routing keys with it, so routing never depends on
// which middleware commit their lockfile resolves. It must exist in src AND in both committed
// builds, merge (never replace) the mapping, and the committed dist must be reproducible from src.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

jest.mock("../src/connection.js", () => ({ isConnected: jest.fn(() => true), getNamedChannel: jest.fn() }));
jest.mock("../dist/connection.js", () => ({ isConnected: jest.fn(() => true), getNamedChannel: jest.fn() }));

const ROOT = path.join(__dirname, "..");

describe.each([["src", "../src/publisher.js"], ["dist", "../dist/publisher.js"]])("%s publisher", (_name, mod) => {
  let publisher;
  beforeEach(() => {
    jest.isolateModules(() => {
      publisher = require(mod);
    });
  });

  test("merges new routing keys and keeps every existing mapping", () => {
    const before = { ...publisher.exchangeMapping };
    publisher.setExchangeMapping({ "payments.example-only.v1": "payment.events" });
    expect(publisher.getExchangeForEvent("payments.example-only.v1")).toBe("payment.events");
    for (const [k, v] of Object.entries(before)) expect(publisher.exchangeMapping[k]).toBe(v);
    expect(Object.keys(publisher.exchangeMapping)).toHaveLength(Object.keys(before).length + 1);
  });

  test("registering the same values again is a no-op; unknown types still fall back", () => {
    publisher.setExchangeMapping({ "payments.payment-link.issued.v1": "payment.events" });
    const snapshot = { ...publisher.exchangeMapping };
    publisher.setExchangeMapping({ "payments.payment-link.issued.v1": "payment.events" });
    expect(publisher.exchangeMapping).toEqual(snapshot);
    expect(publisher.getExchangeForEvent("payments.not-a-real-event.v9")).toBe("application.events");
  });
});

test("the ESM build exposes the same method", () => {
  const esm = fs.readFileSync(path.join(ROOT, "dist/esm/publisher.js"), "utf8");
  expect(esm).toMatch(/setExchangeMapping\(mapping\)\s*\{\s*this\.exchangeMapping = \{ \.\.\.this\.exchangeMapping, \.\.\.mapping \};/);
});

test("committed dist/ is exactly what a clean build of src/ produces", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rmw-build-"));
  fs.cpSync(path.join(ROOT, "src"), path.join(tmp, "src"), { recursive: true });
  fs.cpSync(path.join(ROOT, "scripts"), path.join(tmp, "scripts"), { recursive: true });
  execFileSync(process.execPath, ["scripts/build-cjs.js"], { cwd: tmp, stdio: "ignore" });
  execFileSync(process.execPath, ["scripts/build-esm.js"], { cwd: tmp, stdio: "ignore" });
  const list = (dir) => {
    const out = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : out.push(path.relative(dir, path.join(d, e.name)))));
    walk(dir);
    return out.sort();
  };
  const built = list(path.join(tmp, "dist"));
  expect(built).toEqual(list(path.join(ROOT, "dist")));
  for (const f of built) {
    expect(fs.readFileSync(path.join(tmp, "dist", f), "utf8")).toBe(fs.readFileSync(path.join(ROOT, "dist", f), "utf8"));
  }
});
