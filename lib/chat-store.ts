import { Redis } from "@upstash/redis";
import { getRedisConfig } from "./redis";

export type StoredChatMessage = { role: "user" | "assistant"; content: string };
export type StoredChat = { id: string; title: string; messages: StoredChatMessage[]; modelId: string; skillIds: string[]; updatedAt: string };
const key = (user: string, id: string) => `tossdown-ai:chat:${user}:${id}`;
const indexKey = (user: string) => `tossdown-ai:chat-index:${user}`;
function redis() { const config = getRedisConfig(); return config ? new Redis(config) : null; }
export function chatStoreAvailable() { return Boolean(getRedisConfig()); }
export async function listChats(user: string) { const client = redis(); if (!client) return null; const ids = await client.smembers<string[]>(indexKey(user)); const chats = await Promise.all(ids.map(id => client.get<StoredChat>(key(user, id)))); return chats.filter((chat): chat is StoredChat => Boolean(chat)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ id, title, updatedAt, modelId, skillIds }) => ({ id, title, updatedAt, modelId, skillIds })); }
export async function getChat(user: string, id: string) { const client = redis(); return client ? client.get<StoredChat>(key(user, id)) : null; }
export async function saveChat(user: string, chat: StoredChat) { const client = redis(); if (!client) return false; await client.set(key(user, chat.id), chat); await client.sadd(indexKey(user), chat.id); return true; }
