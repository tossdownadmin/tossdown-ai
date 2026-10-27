import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listSharedMetaAccounts } from "./meta-accounts";

const oldToken = process.env.META_SYSTEM_USER_TOKEN;

describe("shared Meta account discovery", () => {
  beforeEach(() => { process.env.META_SYSTEM_USER_TOKEN = "test-only-token"; });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (oldToken === undefined) delete process.env.META_SYSTEM_USER_TOKEN;
    else process.env.META_SYSTEM_USER_TOKEN = oldToken;
  });

  it("follows a bounded cursor without using Meta's returned URL or leaking the token", async () => {
    const fetch = vi.fn(async (_url: string) => ({ ok: true, json: async () => fetch.mock.calls.length === 1 ?
      { data: [{ id: "act_123", name: "First" }], paging: { next: "https://untrusted.example/next", cursors: { after: "cursor-2" } } } :
      { data: [{ id: "act_456", name: "Second" }] } }));
    vi.stubGlobal("fetch", fetch);
    const result = await listSharedMetaAccounts();
    expect(result).toMatchObject({ configured: true, graphError: null, truncated: false, accounts: [{ id: "act_123" }, { id: "act_456" }] });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toContain("after=cursor-2");
    expect(fetch.mock.calls.every(([url]) => url.startsWith("https://graph.facebook.com/") && !url.includes("test-only-token"))).toBe(true);
  });
});
