import { auth } from "../../../auth";
import { connectionStatus, mcpEnabled } from "../../../lib/mcp";
import { isAllowedEmployeeEmail } from "../../../lib/access";
export const runtime = "nodejs";
export async function GET() { if (mcpEnabled()) { const session = await auth(); if (!isAllowedEmployeeEmail(session?.user?.email)) return Response.json({ error: "Sign in with a verified tossdown.com account." }, { status: 401 }); } return Response.json({ enabled: mcpEnabled(), connections: connectionStatus() }); }
