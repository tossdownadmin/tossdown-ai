import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), readiness: vi.fn() }));
vi.mock("@upstash/redis", () => ({ Redis: class {} }));
vi.mock("@upstash/ratelimit", () => ({ Ratelimit: class {
  static slidingWindow() { return {}; }
  limit = mocks.limit;
} }));
vi.mock("../../../../../auth", () => ({ auth: mocks.auth }));
vi.mock("../../../../../lib/redis", () => ({ getRedisConfig: () => ({ url: "https://test.invalid", token: "test-only" }) }));
vi.mock("../../../../../lib/meta-accounts", () => ({ listSharedMetaAccounts: mocks.readiness }));

import { GET } from "./route";

describe("shared Meta account picker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.limit.mockResolvedValue({ success: true });
    mocks.readiness.mockResolvedValue({ configured: true, graphError: null, truncated: false, accounts: [{ id: "act_123", name: "Shared account", currency: "USD", tasks: ["ADVERTISE"] }], tokenApp: { appId: "private-app" } });
  });

  it("rejects users outside the employee domain before querying Meta", async () => {
    mocks.auth.mockResolvedValue({ user: { email: "outsider@example.com" } });
    expect((await GET()).status).toBe(401);
    expect(mocks.readiness).not.toHaveBeenCalled();
  });

  it("shows the same safe account choices to different signed-in employees", async () => {
    for (const email of ["one@tossdown.com", "two@tossdown.com"]) {
      mocks.auth.mockResolvedValue({ user: { email } });
      const response = await GET();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ configured: true, available: true, graphError: null, truncated: false, accounts: [{ id: "act_123", name: "Shared account", currency: "USD" }] });
    }
    expect(mocks.readiness).toHaveBeenCalledTimes(2);
    const keys = mocks.limit.mock.calls.map(([key]) => key);
    expect(keys[0]).not.toBe(keys[2]);
    expect(keys[1]).toBe("all-employees");
    expect(keys[3]).toBe("all-employees");
  });
});
