import { describe, expect, it } from "vitest";
import { campaignIdSummary } from "./id-summary";

const fields = { accountId: "act_12345", objective: "OUTCOME_TRAFFIC", pixelId: "", assetMode: "EXISTING_CREATIVE", pageId: "", instagramActorId: "", accountImageHash: "", existingCreativeId: "67890" };

describe("campaign ID summary", () => {
  it("shows only the selected account and asset IDs", () => {
    expect(campaignIdSummary(fields, null)).toEqual([
      ["Ad account ID", "act_12345"], ["Existing creative ID", "67890"],
    ]);
  });

  it("includes conditional input and returned object IDs, without stale unused IDs", () => {
    expect(campaignIdSummary({ ...fields, objective: "OUTCOME_SALES", pixelId: "333", assetMode: "ACCOUNT_IMAGE", pageId: "444", instagramActorId: "555", accountImageHash: "a".repeat(32) }, { campaignId: "600", adSetId: "700", creativeId: "800", adId: "900" })).toEqual([
      ["Ad account ID", "act_12345"], ["Meta Pixel ID", "333"], ["Facebook Page ID", "444"], ["Instagram actor ID", "555"], ["Account image hash", "a".repeat(32)], ["Campaign ID", "600"], ["Ad set ID", "700"], ["New creative ID", "800"], ["Ad ID", "900"],
    ]);
  });
});
