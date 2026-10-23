import { describe, expect, it } from "vitest";
import { validateMessages } from "./limits";
describe("request validation",()=>{it("rejects empty and oversized conversations",()=>{expect(validateMessages([])).toBeTruthy();expect(validateMessages([{role:"user",content:""}])).toBeTruthy();expect(validateMessages([{role:"user",content:"ok"}])).toBeNull();});it("rejects invalid roles",()=>expect(validateMessages([{role:"system",content:"x"}])).toBeTruthy());});
