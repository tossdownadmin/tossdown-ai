import { auth } from "../../../auth";
import { connectionStatus, mcpEnabled } from "../../../lib/mcp";
import { isAllowedEmployeeEmail } from "../../../lib/access";
export const runtime = "nodejs";
export async function GET() { if (mcpEnabled()) { const session = await auth(); const email = session?.user?.email; if (typeof email !== "string" || !isAllowedEmployeeEmail(email)) return Response.json({ error: "Sign in with a verified tossdown.com account." }, { status: 401 }); return Response.json({ enabled: true, connections: await connectionStatus(email.toLowerCase()) }); } return Response.json({ enabled: false, connections: await connectionStatus() }); }
