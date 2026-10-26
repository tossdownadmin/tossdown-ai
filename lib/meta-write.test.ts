import { describe, expect, it } from "vitest";
import { META_CREATE_CAMPAIGN_TOOL, metaWriteConfiguration, validateCampaignArgs } from "./meta-write";

describe("guarded Meta campaign writes", () => {
  it("only accepts the explicitly supported campaign tool", () => expect(META_CREATE_CAMPAIGN_TOOL).toBe("ads_create_campaign"));
  it("requires account, name, objective, and an explicit category choice", () => {
    expect(validateCampaignArgs({}).missing).toEqual(expect.arrayContaining(["account_id", "campaign_name", "objective"]));
    expect(validateCampaignArgs({ account_id: "act_1", campaign_name: "Test", objective: "OUTCOME_TRAFFIC", special_ad_categories: [] }).missing).toHaveLength(1);
    expect(validateCampaignArgs({ account_id: "act_1", campaign_name: "Test", objective: "OUTCOME_TRAFFIC", special_ad_categories: ["NONE"] }).missing).toEqual([]);
  });
  it("is disabled unless every server-side write control is configured", () => {
    const previous = process.env.META_WRITE_ENABLED;
    delete process.env.META_WRITE_ENABLED;
    expect(metaWriteConfiguration().enabled).toBe(false);
    if (previous === undefined) delete process.env.META_WRITE_ENABLED; else process.env.META_WRITE_ENABLED = previous;
  });
});
