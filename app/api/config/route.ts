import { allowedModels } from "../../../lib/model-config";
export const runtime = "nodejs";
export async function GET() { return Response.json({ models: allowedModels() }); }
