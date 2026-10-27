import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditSelectedMetaAccount, validMetaAccountId } from "./meta-audit";

const originalToken = process.env.META_SYSTEM_USER_TOKEN;

function graphResponse(data: Record<string, unknown>) {
  return { ok: true, json: async () => data } as Response;
}

describe("shared Meta read-only audit", () => {
  beforeEach(() => {
    process.env.META_SYSTEM_USER_TOKEN = "test-only-token";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalToken === undefined) delete process.env.META_SYSTEM_USER_TOKEN;
    else process.env.META_SYSTEM_USER_TOKEN = originalToken;
  });

  it("rejects malformed account IDs before any Graph call", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(validMetaAccountId("https://example.com")).toBe(false);
    expect(await auditSelectedMetaAccount("https://example.com")).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an account that the shared token cannot access", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("/me/permissions")) return graphResponse({ data: [{ permission: "ads_read", status: "granted" }] });
      if (url.includes("/me/adaccounts")) return graphResponse({ data: [{ id: "act_123", name: "Accessible" }] });
      return graphResponse({ data: {} });
    });
    vi.stubGlobal("fetch", fetch);
    expect(await auditSelectedMetaAccount("act_999")).toMatchObject({ ok: false, error: expect.stringContaining("not accessible") });
    expect(fetch.mock.calls.every(([url]) => !url.includes("/campaigns") && !url.includes("/insights"))).toBe(true);
  });

  it("reads only the selected accessible account with bounded fields and marks incomplete data", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBeUndefined();
      if (url.includes("/me/permissions")) return graphResponse({ data: [{ permission: "ads_read", status: "granted" }] });
      if (url.includes("/me/adaccounts")) return graphResponse({ data: [{ id: "act_123", name: "Accessible", currency: "USD" }] });
      if (url.includes("/campaigns?")) return graphResponse({ data: Array.from({ length: 41 }, (_, index) => ({ id: `c${index}`, name: "Campaign", effective_status: "ACTIVE" })) });
      if (url.includes("/insights?")) return graphResponse({ data: [{ campaign_id: "c1", spend: "12.50", impressions: "100" }] });
      return graphResponse({ data: {} });
    });
    vi.stubGlobal("fetch", fetch);
    const result = await auditSelectedMetaAccount("act_123");
    expect(result).toMatchObject({ ok: true, account: { id: "act_123", name: "Accessible" }, period: "last_30d", truncated: true });
    if (result.ok) expect(result.campaigns).toHaveLength(40);
    expect(JSON.stringify(result)).not.toContain("test-only-token");
    expect(fetch.mock.calls.some(([url]) => url.includes("/act_123/campaigns?") && url.includes("limit=40"))).toBe(true);
    expect(fetch.mock.calls.some(([url]) => url.includes("/act_123/insights?") && url.includes("level=campaign") && url.includes("limit=40"))).toBe(true);
  });
});
