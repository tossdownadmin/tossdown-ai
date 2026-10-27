import { describe, expect, it } from "vitest";
import { completedMessages, requestMessages } from "./chat-client";

describe("chat client messages", () => {
  it("keeps the user's prompt but removes an empty failed assistant reply", () => {
    const messages = [
      { role: "user" as const, content: "Audit this account" },
      { role: "assistant" as const, content: "" },
      { role: "user" as const, content: "Try again" },
    ];
    expect(completedMessages(messages)).toEqual([
      { role: "user", content: "Audit this account" },
      { role: "user", content: "Try again" },
    ]);
    expect(requestMessages(messages)).toEqual(completedMessages(messages));
  });

  it("limits model context to the newest twelve non-empty messages", () => {
    const messages = Array.from({ length: 15 }, (_, index) => ({
      role: index % 2 ? "assistant" as const : "user" as const,
      content: String(index),
    }));
    expect(requestMessages(messages)).toHaveLength(12);
    expect(requestMessages(messages)[0].content).toBe("3");
  });
});
