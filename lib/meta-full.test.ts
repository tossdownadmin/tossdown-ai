import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { graph, getSecure, deleteSecure, claim } = vi.hoisted(() => ({ graph: vi.fn(), getSecure: vi.fn(), deleteSecure: vi.fn(), claim: vi.fn() }));
vi.mock("./meta-direct", async importOriginal => ({ ...(await importOriginal<typeof import("./meta-direct")>()), directGraphRequest: graph }));
vi.mock("./secure-store", () => ({ getSecure, deleteSecure, putSecure: vi.fn() }));
vi.mock("./redis", () => ({ getRedisConfig: () => ({ url: "https://example.test", token: "test" }) }));
vi.mock("@upstash/redis", () => ({ Redis: class { set = claim; } }));

import { adPayload, adSetPayload, creativePayload, executeFullPackage, validateFullInput } from "./meta-full";

const input = {
  accountId: "act_12345", name: "Campaign", objective: "OUTCOME_TRAFFIC", specialAdCategories: [], adSetName: "Ad set", dailyBudget: "1000", country: "PK", ageMin: 18, ageMax: 65, pixelId: "",
  creativeName: "Creative", adName: "Ad", pageId: "123456", instagramActorId: "", primaryText: "Visit us", headline: "Explore", description: "", destinationUrl: "https://example.com", callToAction: "LEARN_MORE",
  imageDigest: "", imageSize: 0, imageType: "image/png",
};
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(128)]);
const args = { ...input, imageDigest: crypto.createHash("sha256").update(png).digest("hex"), imageSize: png.length };
const file = new File([png], "image.png", { type: "image/png" });

describe("full paused package", () => {
  beforeEach(() => {
    graph.mockReset(); getSecure.mockReset(); deleteSecure.mockReset(); claim.mockReset().mockResolvedValue("OK");
    getSecure.mockResolvedValue({ user: "u@tossdown.com", args, digest: crypto.createHash("sha256").update(JSON.stringify(args)).digest("hex"), expiresAt: Date.now() + 60_000 });
  });
  it("requires a reviewed image and explicit inputs", () => {
    expect(validateFullInput(args).issues).toEqual([]);
    expect(validateFullInput({ ...args, objective: "OUTCOME_SALES" }).issues).toContain("A Meta Pixel ID is required for Sales conversion optimization.");
    expect(adSetPayload(args as never, "100").get("status")).toBe("PAUSED");
    expect(adSetPayload(args as never, "100").get("campaign_id")).toBe("100");
    expect(creativePayload(args as never, "hash").get("object_story_spec")).toContain('"image_hash":"hash"');
    expect(adPayload(args as never, "200", "300").get("status")).toBe("PAUSED");
  });
  it("creates and verifies each relationship in sequence", async () => {
    graph.mockResolvedValueOnce({ id: "100" }).mockResolvedValueOnce({ id: "100", status: "PAUSED", objective: "OUTCOME_TRAFFIC" })
      .mockResolvedValueOnce({ id: "200" }).mockResolvedValueOnce({ id: "200", campaign_id: "100", status: "PAUSED" })
      .mockResolvedValueOnce({ images: { "creative.png": { hash: "hash" } } })
      .mockResolvedValueOnce({ id: "300" }).mockResolvedValueOnce({ id: "300", name: "Creative" })
      .mockResolvedValueOnce({ id: "400" }).mockResolvedValueOnce({ id: "400", adset_id: "200", creative: { id: "300" }, status: "PAUSED" });
    const result = await executeFullPackage("u@tossdown.com", "approval", file);
    expect(result).toEqual({ ok: true, created: { campaignId: "100", adSetId: "200", imageHash: "hash", creativeId: "300", adId: "400" }, verified: true });
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
});
