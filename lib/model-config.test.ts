import { afterEach, describe, expect, it } from "vitest";
import { allowedModels, isAllowedModel, QUOTA_CONFIRMED_MODELS } from "./model-config";

const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });

describe("quota-confirmed model allowlist", () => {
  it("shows only configured profiles with positive reviewed quotas", () => {
    process.env.BEDROCK_MODEL_ID = "global.anthropic.claude-sonnet-4-6";
    process.env.BEDROCK_MODEL_IDS = [
      "global.anthropic.claude-opus-4-6-v1",
      "anthropic.claude-sonnet-4-6", // On-demand invocation is unsupported.
      "global.anthropic.claude-sonnet-5", // Screenshot shows zero quota.
      "global.anthropic.claude-opus-4-6-v1",
      "global.anthropic.claude-haiku-4-5-20251001-v1:0",
    ].join(",");
    expect(allowedModels()).toEqual([
      "global.anthropic.claude-sonnet-4-6",
      "global.anthropic.claude-opus-4-6-v1",
      "global.anthropic.claude-haiku-4-5-20251001-v1:0",
    ]);
    expect(isAllowedModel("anthropic.claude-sonnet-4-6")).toBe(false);
    expect(isAllowedModel("global.anthropic.claude-sonnet-5")).toBe(false);
  });

  it("never adds quota-confirmed models that were not configured", () => {
    process.env.BEDROCK_MODEL_ID = "global.anthropic.claude-sonnet-4-6";
    process.env.BEDROCK_MODEL_IDS = "";
    expect(allowedModels()).toEqual(["global.anthropic.claude-sonnet-4-6"]);
    expect(isAllowedModel(QUOTA_CONFIRMED_MODELS[1])).toBe(false);
  });

  it("fails closed when the default is absent or not a reviewed profile", () => {
    process.env.BEDROCK_MODEL_ID = "anthropic.claude-sonnet-4-6";
    process.env.BEDROCK_MODEL_IDS = "global.anthropic.claude-sonnet-4-6";
    expect(allowedModels()).toEqual([]);
    expect(isAllowedModel("global.anthropic.claude-sonnet-4-6")).toBe(false);
    delete process.env.BEDROCK_MODEL_ID;
    expect(allowedModels()).toEqual([]);
  });

  it("permits every reviewed profile when explicitly configured", () => {
    process.env.BEDROCK_MODEL_ID = QUOTA_CONFIRMED_MODELS[0];
    process.env.BEDROCK_MODEL_IDS = QUOTA_CONFIRMED_MODELS.slice(1).join(",");
    expect(allowedModels()).toEqual([...QUOTA_CONFIRMED_MODELS]);
  });
});
