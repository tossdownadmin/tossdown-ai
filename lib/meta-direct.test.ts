import { describe, expect, it } from "vitest";
import { directMetaConfiguration, META_GRAPH_API_VERSION, validateDirectCampaignArgs } from "./meta-direct";

describe("direct Meta Marketing API", () => {
  it("uses the pinned current Graph API version", () => expect(META_GRAPH_API_VERSION).toBe("v26.0"));
  it("requires exact campaign choices", () => {
    expect(validateDirectCampaignArgs({}).missing).toEqual(expect.arrayContaining(["accountId", "name", "objective"]));
    expect(validateDirectCampaignArgs({ accountId: "act_1", name: "Test", objective: "OUTCOME_TRAFFIC", specialAdCategories: [] }).missing).toEqual([]);
  });
  it("reports token configuration independently of the optional write allowlist", () => {
    const oldToken = process.env.META_SYSTEM_USER_TOKEN;
    const oldAccounts = process.env.META_WRITE_ACCOUNT_IDS;
    delete process.env.META_SYSTEM_USER_TOKEN;
    delete process.env.META_WRITE_ACCOUNT_IDS;
    expect(directMetaConfiguration().missing).toEqual(["META_SYSTEM_USER_TOKEN"]);
    if (oldToken === undefined) delete process.env.META_SYSTEM_USER_TOKEN; else process.env.META_SYSTEM_USER_TOKEN = oldToken;
    if (oldAccounts === undefined) delete process.env.META_WRITE_ACCOUNT_IDS; else process.env.META_WRITE_ACCOUNT_IDS = oldAccounts;
  });
});
