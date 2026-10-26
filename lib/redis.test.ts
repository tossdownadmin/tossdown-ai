import { describe, expect, it, afterEach } from "vitest";
import { getRedisConfig } from "./redis";

const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });

describe("Redis configuration", () => {
  it("prefers UPSTASH variables", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://upstash.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "upstash-write-token";
    process.env.KV_REST_API_URL = "https://kv.example";
    process.env.KV_REST_API_TOKEN = "kv-write-token";
    expect(getRedisConfig()).toEqual({ url: "https://upstash.example", token: "upstash-write-token" });
  });
  it("falls back to KV variables only when both are available", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.KV_REST_API_URL = "https://kv.example";
    process.env.KV_REST_API_TOKEN = "kv-write-token";
    expect(getRedisConfig()).toEqual({ url: "https://kv.example", token: "kv-write-token" });
  });
  it("fails closed for an incomplete pair", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.KV_REST_API_URL = "https://kv.example";
    delete process.env.KV_REST_API_TOKEN;
    expect(getRedisConfig()).toBeNull();
  });
});
