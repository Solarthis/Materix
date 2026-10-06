import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { secretSet, secretGet, saveSession, loadSessions, deleteSession } from "./storage";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("matrix-js-sdk", () => ({ createClient: vi.fn() }));
vi.mock("./account", () => ({ MatrixAccount: class {} }));
vi.mock("./cryptoStoreKey", () => ({ createStorageKey: vi.fn() }));
vi.mock("./discovery", () => ({ resolveHomeserver: vi.fn() }));
const session = { userId: "@fixture:example.invalid", deviceId: "TEST", accessToken: "synthetic-value", homeserverUrl: "https://example.invalid" };
let values: Map<string, string>;
beforeEach(() => {
  values = new Map(); invoke.mockReset();
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  vi.stubGlobal("localStorage", {
    get length() { return values.size; },
    key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("session persistence failure boundaries", () => {
  it("does not write desktop secrets to localStorage when keychain fails", async () => {
    invoke.mockRejectedValue(new Error("locked"));
    await expect(secretSet("key", "synthetic")).rejects.toThrow();
    await expect(saveSession("account", session)).rejects.toThrow();
    expect(values.size).toBe(0);
  });
  it("does not resurrect localStorage secrets on desktop keychain misses", async () => {
    values.set("key", "stale-synthetic");invoke.mockResolvedValue(null);
    expect(await secretGet("key")).toBeNull();
  });
  it("propagates desktop read failures without fallback", async () => {
    values.set("key", "stale-synthetic");invoke.mockRejectedValue(new Error("locked"));
    await expect(secretGet("key")).rejects.toThrow();
    await expect(loadSessions()).rejects.toThrow();
  });
  it("never loads browser sessions into the desktop account list", async () => {
    values.set("materix.account.browser", JSON.stringify(session));invoke.mockResolvedValue([]);
    expect((await loadSessions()).size).toBe(0);
  });
  it("preserves malformed browser records and still reads later valid records", async () => {
    vi.stubGlobal("window", {});
    values.set("materix.account.bad", "{");values.set("materix.account.good", JSON.stringify(session));
    const result = await loadSessions();
    expect(result.get("good")).toEqual(session);expect(values.get("materix.account.bad")).toBe("{");
  });
  it("skips one malformed keychain record without dropping later accounts", async () => {
    invoke.mockImplementation(async (cmd, args) => cmd === "secret_list_keys" ? ["materix.account.bad", "materix.account.good"] : args.key.endsWith("bad") ? "{" : JSON.stringify(session));
    expect((await loadSessions()).get("good")).toEqual(session);
  });
  it("failed desktop deletion stays an error and preserves fallback record", async () => {
    values.set("materix.account.account", "retained");invoke.mockRejectedValue(new Error("locked"));
    await expect(deleteSession("account")).rejects.toThrow();
    expect(values.get("materix.account.account")).toBe("retained");
  });
  it("web save, load and explicit delete still work", async () => {
    vi.stubGlobal("window", {});await saveSession("account", session);
    expect((await loadSessions()).get("account")).toEqual(session);
    await deleteSession("account");expect(values.size).toBe(0);expect(invoke).not.toHaveBeenCalled();
  });
  it("manager keeps the account when durable deletion fails", async () => {
    vi.resetModules();
    const { accountManager } = await import("./manager");
    const accounts = Reflect.get(accountManager, "accounts") as Map<string, unknown>;
    const account = { destroy: vi.fn() };accounts.set("account", account);
    invoke.mockRejectedValue(new Error("locked"));
    await expect(accountManager.logout("account")).rejects.toThrow();
    expect(accounts.has("account")).toBe(true);expect(account.destroy).not.toHaveBeenCalled();
  });
  it("does not restore valid JSON with an invalid session shape", async () => {
    vi.stubGlobal("window", {});values.set("materix.account.invalid", JSON.stringify({ accessToken: 3 }));
    expect((await loadSessions()).size).toBe(0);expect(values.has("materix.account.invalid")).toBe(true);
  });
});
