import { auth } from "../../../../../auth";
import { disconnectMeta } from "../../../../../lib/meta-oauth";
export const runtime = "nodejs";
export async function POST() { const session = await auth(); if (!session?.user?.email?.toLowerCase().endsWith("@tossdown.com")) return Response.json({ error: "Unauthorized" }, { status: 401 }); await disconnectMeta(session.user.email.toLowerCase()); return Response.json({ connected: false }); }
