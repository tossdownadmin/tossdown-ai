import crypto from "node:crypto";
import { auth } from "../../../auth";
import { isAllowedEmployeeEmail } from "../../../lib/access";
import { chatStoreAvailable, getChat, listChats, saveChat, type StoredChat } from "../../../lib/chat-store";
import { LIMITS, validateMessages } from "../../../lib/limits";
import { isAllowedModel } from "../../../lib/model-config";
import { selectedSkills } from "../../../lib/skills";

export const runtime = "nodejs";
async function employee() { const session = await auth(); const email = session?.user?.email?.toLowerCase(); return email && isAllowedEmployeeEmail(email) ? email : null; }
export async function GET(request: Request) { const user = await employee(); if (!user) return Response.json({ error: "Sign in with a verified tossdown.com account." }, { status: 401 }); if (!chatStoreAvailable()) return Response.json({ error: "Shared chat history is not configured." }, { status: 503 }); const id = new URL(request.url).searchParams.get("id"); const result = id ? await getChat(user, id) : await listChats(user); return Response.json({ chat: id ? result : undefined, chats: id ? undefined : result }, { headers: { "Cache-Control": "no-store" } }); }
export async function POST(request: Request) {
  const user = await employee(); if (!user) return Response.json({ error: "Sign in with a verified tossdown.com account." }, { status: 401 }); if (!chatStoreAvailable()) return Response.json({ error: "Shared chat history is not configured." }, { status: 503 });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const input = body as { id?: unknown; messages?: unknown; modelId?: unknown; skillIds?: unknown }; const validation = validateMessages(input.messages); if (validation) return Response.json({ error: validation }, { status: 400 }); if (!isAllowedModel(input.modelId)) return Response.json({ error: "That model is not enabled on the server." }, { status: 400 });
  const messages = input.messages as StoredChat["messages"]; const id = typeof input.id === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(input.id) ? input.id : crypto.randomUUID(); const first = messages.find(message => message.role === "user")?.content || "New conversation"; const chat: StoredChat = { id, title: first.replace(/\s+/g, " ").trim().slice(0, 72), messages, modelId: input.modelId, skillIds: selectedSkills(input.skillIds).map(skill => skill.id), updatedAt: new Date().toISOString() }; await saveChat(user, chat); return Response.json({ chat: { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, modelId: chat.modelId, skillIds: chat.skillIds } });
}
