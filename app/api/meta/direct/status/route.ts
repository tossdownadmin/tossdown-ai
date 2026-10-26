import { auth } from "../../../../../auth";
import { isAllowedEmployeeEmail } from "../../../../../lib/access";
import { directMetaReadiness } from "../../../../../lib/meta-direct";
export const runtime = "nodejs";
export async function GET() { const session = await auth(); const email = session?.user?.email?.toLowerCase(); if (!email || !isAllowedEmployeeEmail(email)) return Response.json({ error: "Sign in with a verified tossdown.com account." }, { status: 401 }); return Response.json(await directMetaReadiness()); }
