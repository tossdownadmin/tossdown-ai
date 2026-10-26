import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { graph, getSecure, deleteSecure, putSecure, claim, readiness, verifyAsset } = vi.hoisted(() => ({ graph: vi.fn(), getSecure: vi.fn(), deleteSecure: vi.fn(), putSecure: vi.fn(), claim: vi.fn(), readiness: vi.fn(), verifyAsset: vi.fn() }));
vi.mock("./meta-direct", async importOriginal => ({ ...(await importOriginal<typeof import("./meta-direct")>()), directGraphRequest: graph, directMetaConfiguration: () => ({ configured: true, writeEnabled: true }), directMetaReadiness: readiness }));
vi.mock("./secure-store", () => ({ getSecure, deleteSecure, putSecure }));
vi.mock("./redis", () => ({ getRedisConfig: () => ({ url: "https://example.test", token: "test" }) }));
vi.mock("./meta-assets", () => ({ verifyMetaAsset: verifyAsset }));
vi.mock("@upstash/redis", () => ({ Redis: class { set = claim; } }));

import { adPayload, adSetPayload, budgetToMinorUnits, creativePayload, executeFullPackage, prepareFullPackage, validateFullInput } from "./meta-full";

const input = {
  accountId: "act_12345", name: "Campaign", objective: "OUTCOME_TRAFFIC", specialAdCategories: [], adSetName: "Ad set", dailyBudget: "1000", country: "PK", ageMin: 18, ageMax: 65, pixelId: "",
  creativeName: "Creative", adName: "Ad", pageId: "123456", instagramActorId: "", primaryText: "Visit us", headline: "Explore", description: "", destinationUrl: "https://example.com", callToAction: "LEARN_MORE",
  assetMode: "UPLOAD", accountImageHash: "", existingCreativeId: "", assetName: "", assetSummary: "", imageDigest: "", imageSize: 0, imageType: "image/png",
};
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(128)]);
const args = { ...input, dailyBudgetMinor: "100000", currency: "CAD", imageDigest: crypto.createHash("sha256").update(png).digest("hex"), imageSize: png.length };
const file = new File([png], "image.png", { type: "image/png" });

describe("full paused package", () => {
  beforeEach(() => {
    graph.mockReset(); getSecure.mockReset(); deleteSecure.mockReset(); putSecure.mockReset(); claim.mockReset().mockResolvedValue("OK"); verifyAsset.mockReset().mockImplementation(async (_account, _kind, id) => ({ id, name: "Existing asset", summary: "Existing copy" }));
    readiness.mockReset().mockResolvedValue({ permissions: ["ads_management:granted"], accounts: [{ id: "act_12345", currency: "CAD" }], graphError: null });
    getSecure.mockResolvedValue({ user: "u@tossdown.com", args, digest: crypto.createHash("sha256").update(JSON.stringify(args)).digest("hex"), expiresAt: Date.now() + 60_000 });
  });
  it("requires a reviewed image and explicit inputs", () => {
    expect(validateFullInput(args).issues).toEqual([]);
    expect(validateFullInput({ ...args, objective: "OUTCOME_SALES" }).issues).toContain("A Meta Pixel ID is required for Sales conversion optimization.");
    expect(adSetPayload(args as never, "100").get("status")).toBe("PAUSED");
    expect(adSetPayload(args as never, "100").get("campaign_id")).toBe("100");
    expect(adSetPayload(args as never, "100").get("daily_budget")).toBe("100000");
    expect(creativePayload(args as never, "hash").get("object_story_spec")).toContain('"image_hash":"hash"');
    expect(adPayload(args as never, "200", "300").get("status")).toBe("PAUSED");
  });
  it("converts normal currency amounts exactly and rejects invalid precision", () => {
    expect(budgetToMinorUnits("4", "CAD")).toBe("400");
    expect(budgetToMinorUnits("4.00", "CAD")).toBe("400");
    expect(budgetToMinorUnits("1.43", "CAD")).toBe("143");
    expect(budgetToMinorUnits("4", "JPY")).toBe("4");
    expect(budgetToMinorUnits("4.123", "KWD")).toBe("4123");
    expect(() => budgetToMinorUnits("4.001", "CAD")).toThrow("decimal places");
    expect(() => budgetToMinorUnits("0", "CAD")).toThrow();
  });
  it("binds the converted budget to the trusted account currency before approval", async () => {
    const prepared = await prepareFullPackage("u@tossdown.com", { ...args, dailyBudget: "4.00" });
    expect(prepared).toMatchObject({ ok: true, args: { dailyBudget: "4.00", dailyBudgetMinor: "400", currency: "CAD" } });
    if (!prepared.ok) throw new Error("Expected an approved package.");
    expect(adSetPayload(prepared.args, "100").get("daily_budget")).toBe("400");
    expect(putSecure).toHaveBeenCalledOnce();
    expect(putSecure.mock.calls[0][1].args.dailyBudgetMinor).toBe("400");
    const invalid = await prepareFullPackage("u@tossdown.com", { ...args, dailyBudget: "4.001" });
    expect(invalid).toMatchObject({ ok: false });
    expect(putSecure).toHaveBeenCalledOnce();
  });
  it("rejects stale approvals using the old minor-unit contract before any Meta write", async () => {
    const oldArgs = { ...args, dailyBudgetMinor: "", currency: "" };
    getSecure.mockResolvedValueOnce({ user: "u@tossdown.com", args: oldArgs, digest: crypto.createHash("sha256").update(JSON.stringify(oldArgs)).digest("hex"), expiresAt: Date.now() + 60_000 });
    expect(await executeFullPackage("u@tossdown.com", "approval", file)).toMatchObject({ ok: false, error: "Budget approval is invalid. Review the package again." });
    expect(graph).not.toHaveBeenCalled();
  });
  it("creates and verifies each relationship in sequence", async () => {
    graph.mockResolvedValueOnce({ id: "100" }).mockResolvedValueOnce({ id: "100", status: "PAUSED", objective: "OUTCOME_TRAFFIC" })
      .mockResolvedValueOnce({ id: "200" }).mockResolvedValueOnce({ id: "200", campaign_id: "100", status: "PAUSED" })
      .mockResolvedValueOnce({ images: { "creative.png": { hash: "hash" } } })
      .mockResolvedValueOnce({ id: "300" }).mockResolvedValueOnce({ id: "300", name: "Creative" })
      .mockResolvedValueOnce({ id: "400" }).mockResolvedValueOnce({ id: "400", adset_id: "200", creative: { id: "300" }, status: "PAUSED" });
    const result = await executeFullPackage("u@tossdown.com", "approval", file);
    expect(result).toEqual({ ok: true, created: { campaignId: "100", adSetId: "200", imageHash: "hash", creativeId: "300", adId: "400" }, reused: {}, verified: true });
    expect(graph).toHaveBeenCalledTimes(9);
    expect((graph.mock.calls[0][1].body as URLSearchParams).get("status")).toBe("PAUSED");
    expect((graph.mock.calls[2][1].body as URLSearchParams).get("status")).toBe("PAUSED");
    expect((graph.mock.calls[7][1].body as URLSearchParams).get("status")).toBe("PAUSED");
  });
  it("stops on a later failure and reports prior IDs without retrying", async () => {
    graph.mockResolvedValueOnce({ id: "100" }).mockResolvedValueOnce({ id: "100", status: "PAUSED", objective: "OUTCOME_TRAFFIC" }).mockRejectedValueOnce(new Error("ad set rejected"));
    const result = await executeFullPackage("u@tossdown.com", "approval", file);
    expect(result).toMatchObject({ ok: false, stage: "ad set", created: { campaignId: "100" } });
    expect(graph).toHaveBeenCalledTimes(3);
  });
  it("rejects a changed image before any write", async () => {
    const changed = new File([Buffer.alloc(136)], "image.png", { type: "image/png" });
    expect(await executeFullPackage("u@tossdown.com", "approval", changed)).toMatchObject({ ok: false });
    expect(graph).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });
  it("reuses an account image without uploading while creating a new paused ad", async () => {
    const imageArgs = { ...args, assetMode: "ACCOUNT_IMAGE", accountImageHash: "a".repeat(32), imageDigest: "", imageSize: 0 };
    getSecure.mockResolvedValueOnce({ user: "u@tossdown.com", args: imageArgs, digest: crypto.createHash("sha256").update(JSON.stringify(imageArgs)).digest("hex"), expiresAt: Date.now() + 60_000 });
    graph.mockResolvedValueOnce({ id: "100" }).mockResolvedValueOnce({ id: "100", status: "PAUSED", objective: "OUTCOME_TRAFFIC" })
      .mockResolvedValueOnce({ id: "200" }).mockResolvedValueOnce({ id: "200", campaign_id: "100", status: "PAUSED" })
      .mockResolvedValueOnce({ id: "300" }).mockResolvedValueOnce({ id: "300", name: "Creative" })
      .mockResolvedValueOnce({ id: "400" }).mockResolvedValueOnce({ id: "400", adset_id: "200", creative: { id: "300" }, status: "PAUSED" });
    expect(await executeFullPackage("u@tossdown.com", "approval")).toMatchObject({ ok: true, reused: { imageHash: "a".repeat(32) }, created: { creativeId: "300", adId: "400" } });
    expect(graph).toHaveBeenCalledTimes(8);
    expect(graph.mock.calls.map(call => call[0])).not.toContain("/act_12345/adimages");
    expect((graph.mock.calls[4][1].body as URLSearchParams).get("object_story_spec")).toContain('"image_hash":"' + "a".repeat(32) + '"');
    expect((graph.mock.calls[6][1].body as URLSearchParams).get("status")).toBe("PAUSED");
  });
  it("reuses an existing creative unchanged and skips image and creative writes", async () => {
    const existingArgs = { ...args, assetMode: "EXISTING_CREATIVE", existingCreativeId: "30000", creativeName: "", pageId: "", primaryText: "", headline: "", destinationUrl: "", imageDigest: "", imageSize: 0 };
    expect(validateFullInput(existingArgs).issues).toEqual([]);
    getSecure.mockResolvedValueOnce({ user: "u@tossdown.com", args: existingArgs, digest: crypto.createHash("sha256").update(JSON.stringify(existingArgs)).digest("hex"), expiresAt: Date.now() + 60_000 });
    graph.mockResolvedValueOnce({ id: "100" }).mockResolvedValueOnce({ id: "100", status: "PAUSED", objective: "OUTCOME_TRAFFIC" })
      .mockResolvedValueOnce({ id: "200" }).mockResolvedValueOnce({ id: "200", campaign_id: "100", status: "PAUSED" })
      .mockResolvedValueOnce({ id: "400" }).mockResolvedValueOnce({ id: "400", adset_id: "200", creative: { id: "30000" }, status: "PAUSED" });
    expect(await executeFullPackage("u@tossdown.com", "approval")).toMatchObject({ ok: true, reused: { creativeId: "30000" }, created: { campaignId: "100", adSetId: "200", adId: "400" } });
    expect(graph).toHaveBeenCalledTimes(6);
    expect(graph.mock.calls.map(call => call[0])).not.toContain("/act_12345/adimages");
    expect(graph.mock.calls.map(call => call[0])).not.toContain("/act_12345/adcreatives");
    expect((graph.mock.calls[4][1].body as URLSearchParams).get("creative")).toBe('{"creative_id":"30000"}');
    expect((graph.mock.calls[4][1].body as URLSearchParams).get("status")).toBe("PAUSED");
  });
  it("rejects an unavailable selected asset before claiming or writing", async () => {
    const existingArgs = { ...args, assetMode: "EXISTING_CREATIVE", existingCreativeId: "30000", imageDigest: "", imageSize: 0 };
    getSecure.mockResolvedValueOnce({ user: "u@tossdown.com", args: existingArgs, digest: crypto.createHash("sha256").update(JSON.stringify(existingArgs)).digest("hex"), expiresAt: Date.now() + 60_000 });
    verifyAsset.mockRejectedValueOnce(new Error("Selected creative is not available in this ad account."));
    expect(await executeFullPackage("u@tossdown.com", "approval")).toMatchObject({ ok: false, error: "Selected creative is not available in this ad account." });
    expect(claim).not.toHaveBeenCalled(); expect(graph).not.toHaveBeenCalled();
  });
});
