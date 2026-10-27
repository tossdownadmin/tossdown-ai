import { describe, expect, it } from "vitest";
import { withSharedMetaAccess } from "./meta-connection-view";

describe("shared Meta connection in the chat UI", () => {
  it("makes the Meta picker usable when an employee has no personal MCP OAuth", () => {
    const connections = [{ id: "meta_ads" as const, label: "Meta Ads", status: "disconnected", allowlistReady: false }];
    expect(withSharedMetaAccess(connections, true)).toMatchObject([{ id: "meta_ads", status: "configured", allowlistReady: true }]);
    expect(withSharedMetaAccess(connections, false)).toEqual(connections);
  });

  it("shows the shared Meta connection even if MCP status could not load", () => {
    expect(withSharedMetaAccess([], true)).toEqual([{ id: "meta_ads", label: "Meta Ads", status: "configured", allowlistReady: true }]);
  });
});
