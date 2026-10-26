import { beforeEach, describe, expect, it, vi } from "vitest";

const { rate, readiness, listAssets, prepare, execute } = vi.hoisted(() => ({
  rate: vi.fn(), readiness: vi.fn(), listAssets: vi.fn(), prepare: vi.fn(), execute: vi.fn(),
}));
vi.mock("@upstash/redis", () => ({ Redis: class {} }));
vi.mock("@upstash/ratelimit", () => ({ Ratelimit: class { static slidingWindow() { return {}; } limit = rate; } }));
vi.mock("../../../../lib/redis", () => ({ getRedisConfig: () => ({ url: "https://example.test", token: "test" }) }));
vi.mock("../../../../lib/meta-direct", () => ({ directMetaReadiness: readiness, publicMetaError: () => undefined, sanitizedGraphError: () => "Meta error" }));
vi.mock("../../../../lib/meta-assets", () => ({ listMetaAssets: listAssets }));
vi.mock("../../../../lib/meta-full", () => ({ prepareFullPackage: prepare, executeFullPackage: execute }));

import { GET as status } from "./status/route";
import { GET as assets } from "./assets/route";
import { POST as prepareRoute } from "./full/prepare/route";
import { POST as executeRoute } from "./full/execute/route";
import { PUBLIC_CAMPAIGN_BUILDER_ACTOR } from "../../../../lib/public-campaign-builder";

describe("public campaign-builder routes", () => {
  beforeEach(() => {
    rate.mockReset().mockResolvedValue({ success: true });
    readiness.mockReset().mockResolvedValue({ accounts: [{ id: "act_12345", name: "Account", currency: "CAD", tasks: ["MANAGE"] }], permissions: ["ads_management:granted"], tokenApp: { appId: "secret-diagnostic" } });
    listAssets.mockReset().mockResolvedValue({ items: [] });
    prepare.mockReset().mockResolvedValue({ ok: true, approvalId: "123" });
    execute.mockReset().mockResolvedValue({ ok: true, verified: true });
  });

  it("lists only form account fields without login or token diagnostics", async () => {
    const response = await status();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accounts: [{ id: "act_12345", name: "Account", currency: "CAD" }] });
    expect(rate).toHaveBeenCalledWith(PUBLIC_CAMPAIGN_BUILDER_ACTOR);
  });

  it("loads account assets without a Tossdown session", async () => {
    const response = await assets(new Request("https://example.test/api/meta/direct/assets?accountId=act_12345&kind=creative"));
    expect(response.status).toBe(200);
    expect(listAssets).toHaveBeenCalledWith("act_12345", "creative", "");
  });

  it("prepares and executes using the same one-time approval actor", async () => {
    const prepared = await prepareRoute(new Request("https://example.test/api/meta/direct/full/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: "act_12345" }) }));
    expect(prepared.status).toBe(200);
    expect(prepare).toHaveBeenCalledWith(PUBLIC_CAMPAIGN_BUILDER_ACTOR, { accountId: "act_12345" });

    const form = new FormData(); form.set("approvalId", "00000000-0000-4000-8000-000000000001");
    const completed = await executeRoute(new Request("https://example.test/api/meta/direct/full/execute", { method: "POST", body: form }));
    expect(completed.status).toBe(200);
    expect(execute).toHaveBeenCalledWith(PUBLIC_CAMPAIGN_BUILDER_ACTOR, "00000000-0000-4000-8000-000000000001", undefined);
  });

  it("keeps rate limiting on anonymous writes", async () => {
    rate.mockResolvedValueOnce({ success: false });
    const response = await prepareRoute(new Request("https://example.test/api/meta/direct/full/prepare", { method: "POST", body: "{}" }));
    expect(response.status).toBe(429);
    expect(prepare).not.toHaveBeenCalled();
  });
});
