import { describe, expect, it, afterEach } from "vitest";
import { allowedModels, isAllowedModel } from "./model-config";
const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });
describe("model allowlist", () => { it("keeps the default and explicit server models", () => { process.env.BEDROCK_MODEL_ID = "default-model"; process.env.BEDROCK_MODEL_IDS = "second-model, third-model"; expect(allowedModels()).toEqual(["default-model", "second-model", "third-model"]); }); it("rejects client models not configured on the server", () => { process.env.BEDROCK_MODEL_ID = "default-model"; process.env.BEDROCK_MODEL_IDS = ""; expect(isAllowedModel("unknown-model")).toBe(false); }); });
