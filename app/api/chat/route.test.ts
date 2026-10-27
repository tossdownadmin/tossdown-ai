import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), limit: vi.fn(), discoverTools: vi.fn(), directMetaToolDefinitions: vi.fn(), runBedrock: vi.fn(),
}));

vi.mock("@upstash/redis", () => ({ Redis: class {} }));
vi.mock("@upstash/ratelimit", () => ({ Ratelimit: class {
  static slidingWindow() { return {}; }
  limit = mocks.limit;
} }));
vi.mock("../../../auth", () => ({ auth: mocks.auth }));
vi.mock("../../../lib/redis", () => ({ getRedisConfig: () => ({ url: "https://test.invalid", token: "test-only" }) }));
vi.mock("../../../lib/model-config", () => ({ isAllowedModel: () => true }));
vi.mock("../../../lib/limits", () => ({ LIMITS: { maxRequestBytes: 100_000 }, validateMessages: () => null }));
vi.mock("../../../lib/mcp", () => ({ mcpEnabled: () => true, discoverTools: mocks.discoverTools }));
vi.mock("../../../lib/meta-direct", () => ({ directMetaConfiguration: () => ({ configured: true }) }));
vi.mock("../../../lib/skills", () => ({ selectedSkills: () => [] }));
vi.mock("../../../lib/bedrock", () => ({ directMetaToolDefinitions: mocks.directMetaToolDefinitions, runBedrock: mocks.runBedrock }));

import { POST } from "./route";

function chatRequest() {
  return new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "Audit the selected account" }], modelId: "test-model", enabledConnections: ["meta_ads"], selectedAccountId: "act_123" }) });
}

describe("shared Meta chat routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.limit.mockResolvedValue({ success: true });
    mocks.directMetaToolDefinitions.mockReturnValue([{ name: "meta_audit_selected_account", kind: "direct_meta", accountId: "act_123" }]);
    mocks.runBedrock.mockImplementation(async function* () { yield { type: "text", text: "Audit ready" }; });
  });

  it("rejects an unauthenticated user", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await POST(chatRequest());
    expect(response.status).toBe(401);
    expect(mocks.runBedrock).not.toHaveBeenCalled();
  });

  it("lets another verified employee use the shared account without personal Meta MCP OAuth", async () => {
    mocks.auth.mockResolvedValue({ user: { email: "other.employee@tossdown.com" } });
    const response = await POST(chatRequest());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Audit ready");
    expect(mocks.discoverTools).not.toHaveBeenCalled();
    expect(mocks.directMetaToolDefinitions).toHaveBeenCalledWith("other.employee@tossdown.com", "act_123");
    expect(mocks.runBedrock.mock.calls[0][2]).toEqual(expect.arrayContaining([expect.objectContaining({ name: "meta_audit_selected_account", accountId: "act_123" })]));
  });
});
