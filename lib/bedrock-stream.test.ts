import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn(), callTool: vi.fn() }));
vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class { send = mocks.send; },
  ConverseStreamCommand: class { constructor(public input: unknown) {} },
}));
vi.mock("./mcp", () => ({ callTool: mocks.callTool }));

import { runBedrock, type BedrockEvent, type BedrockTool } from "./bedrock";

const tool = {
  name: "meta_ads__ads_get_ad_accounts",
  serverName: "ads_get_ad_accounts",
  connection: "meta_ads",
  inputSchema: { type: "object", properties: { account_id: { type: "string" } } },
  client: {},
} as unknown as BedrockTool;

function toolStream() {
  return { stream: (async function* () {
    yield { contentBlockStart: { contentBlockIndex: 0, start: { toolUse: { toolUseId: "tool-1", name: tool.name } } } };
    yield { contentBlockDelta: { contentBlockIndex: 0, delta: { toolUse: { input: '{"account_id":"act_123"}' } } } };
    yield { messageStop: { stopReason: "tool_use" } };
  })() };
}

function finalStream() {
  return { stream: (async function* () {
    yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "Account review ready." } } };
    yield { messageStop: { stopReason: "end_turn" } };
  })() };
}

describe("streamed MCP tool dispatch", () => {
  beforeEach(() => { mocks.send.mockReset(); mocks.callTool.mockReset(); });

  it("uses the already parsed tool input, executes MCP, and sends a matching result back to Bedrock", async () => {
    mocks.send.mockResolvedValueOnce(toolStream()).mockResolvedValueOnce(finalStream());
    mocks.callTool.mockResolvedValue({ content: [{ type: "text", text: "Account list" }] });

    const events: BedrockEvent[] = [];
    for await (const event of runBedrock([{ role: "user", content: "Review my account" }], "test-profile", [tool])) events.push(event);

    expect(mocks.callTool).toHaveBeenCalledWith(tool, { account_id: "act_123" });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    const continuation = mocks.send.mock.calls[1][0].input.messages;
    expect(continuation[1]).toMatchObject({ role: "assistant", content: [{ toolUse: { toolUseId: "tool-1", name: tool.name, input: { account_id: "act_123" } } }] });
    expect(continuation[2]).toMatchObject({ role: "user", content: [{ toolResult: { toolUseId: "tool-1", status: "success", content: [{ text: "Account list" }] } }] });
    expect(events).toContainEqual({ type: "tool_result", name: tool.name, ok: true });
    expect(events).toContainEqual({ type: "text", text: "Account review ready." });
  });

  it("stops after a failed MCP batch without repeated model calls or leaking raw error data", async () => {
    mocks.send.mockResolvedValueOnce(toolStream());
    mocks.callTool.mockResolvedValue({ isError: true, content: [{ type: "text", text: "Permission denied for account 123 secret-token" }] });
    const events: BedrockEvent[] = [];
    await expect(async () => {
      for await (const event of runBedrock([{ role: "user", content: "Review my account" }], "test-profile", [tool])) events.push(event);
    }).rejects.toMatchObject({ message: "MCP_TOOLS_FAILED", code: "permission" });
    expect(mocks.callTool).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: "tool_result", name: tool.name, ok: false, failureCode: "permission" });
    expect(JSON.stringify(events)).not.toContain("secret-token");
  });
});
