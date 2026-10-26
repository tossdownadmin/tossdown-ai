import crypto from "node:crypto";
import { Redis } from "@upstash/redis";
import { getRedisConfig } from "./redis";

function redis() { const config = getRedisConfig(); return config ? new Redis(config) : null; }
function key() { const raw = process.env.MCP_TOKEN_ENCRYPTION_KEY; if (!raw) throw new Error("MCP_TOKEN_ENCRYPTION_KEY is not configured"); const value = Buffer.from(raw, "base64"); if (value.length !== 32) throw new Error("MCP_TOKEN_ENCRYPTION_KEY must be base64 for 32 bytes"); return value; }
export async function putSecure<T>(name: string, value: T, ttlSeconds: number) { const r = redis(); if (!r) throw new Error("Redis is not configured"); const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv); const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]); const payload = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"); await r.set(name, payload, { ex: ttlSeconds }); }
export async function getSecure<T>(name: string) { const r = redis(); if (!r) return null; const payload = await r.get<string>(name); if (!payload) return null; const bytes = Buffer.from(payload, "base64url"); const decipher = crypto.createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as T; }
export async function deleteSecure(name: string) { const r = redis(); if (r) await r.del(name); }
