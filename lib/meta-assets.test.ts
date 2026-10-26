import { beforeEach, describe, expect, it, vi } from "vitest";

const { graph, readiness } = vi.hoisted(() => ({ graph: vi.fn(), readiness: vi.fn() }));
vi.mock("./meta-direct", () => ({ directGraphRequest: graph, directMetaReadiness: readiness }));

import { listMetaAssets, verifyMetaAsset } from "./meta-assets";

describe("account-scoped Meta assets", () => {
  beforeEach(() => {
    graph.mockReset(); readiness.mockReset().mockResolvedValue({ graphError: null, permissions: ["ads_management:granted"], accounts: [{ id: "act_12345" }] });
  });
  it("lists only usable account images with a safe preview and an opaque cursor", async () => {
    graph.mockResolvedValueOnce({ data: [
      { hash: "a".repeat(32), name: "Logo", account_id: "12345", url_128: "https://scontent.fbcdn.net/logo.jpg?width=128" },
      { hash: "b".repeat(32), name: "Internal", status: "INTERNAL" },
      { hash: "c".repeat(32), name: "Other account", account_id: "67890" },
      { hash: "d".repeat(32), name: "Unsafe preview", url_128: "https://example.com/image.jpg?access_token=secret" },
    ], paging: { cursors: { after: "opaque-next" }, next: "https://graph.facebook.com/v26.0/act_12345/adimages?access_token=secret" } });
    const result = await listMetaAssets("act_12345", "image");
    expect(result.items.map(item => item.name)).toEqual(["Logo", "Unsafe preview"]);
    expect(result.items[0].previewUrl).toContain("fbcdn.net");
    expect(result.items[1].previewUrl).toBeUndefined();
    expect(result.nextCursor).toBe("opaque-next");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(graph.mock.calls[0][0]).toContain("/act_12345/adimages?");
  });
  it("rejects an account the token cannot access before a Graph asset read", async () => {
    await expect(listMetaAssets("act_67890", "creative")).rejects.toThrow("unavailable");
    expect(graph).not.toHaveBeenCalled();
  });
  it("verifies a creative belongs to the selected account", async () => {
    graph.mockResolvedValueOnce({ id: "30000", account_id: "act_67890", name: "Other creative" });
    await expect(verifyMetaAsset("act_12345", "creative", "30000")).rejects.toThrow("not available");
    graph.mockResolvedValueOnce({ id: "30000", account_id: "12345", name: "Existing creative", title: "Old headline" });
    await expect(verifyMetaAsset("act_12345", "creative", "30000")).resolves.toMatchObject({ id: "30000", name: "Existing creative", summary: "Old headline" });
  });
  it("rejects a missing account image", async () => {
    graph.mockResolvedValueOnce({ data: [] });
    await expect(verifyMetaAsset("act_12345", "image", "a".repeat(32))).rejects.toThrow("not available");
  });
});
