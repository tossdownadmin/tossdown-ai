import { describe, expect, it } from "vitest";
import { isAllowedEmployeeEmail } from "./access";
describe("MCP access protection", () => { it("rejects missing and external accounts", () => { expect(isAllowedEmployeeEmail(undefined)).toBe(false); expect(isAllowedEmployeeEmail("person@example.com")).toBe(false); }); it("accepts verified tossdown accounts case-insensitively", () => expect(isAllowedEmployeeEmail("Employee@TOSSDOWN.COM")).toBe(true)); });
