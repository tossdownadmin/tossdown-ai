import { allowedModels } from "../../../lib/model-config";
import { SKILLS } from "../../../lib/skills";
export const runtime = "nodejs";
export async function GET() { return Response.json({ models: allowedModels(), skills: SKILLS.map(({ id, name, description }) => ({ id, name, description })) }); }
