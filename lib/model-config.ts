export function allowedModels() { const current = process.env.BEDROCK_MODEL_ID; return current ? Array.from(new Set([current, ...(process.env.BEDROCK_MODEL_IDS || "").split(",").map(s => s.trim()).filter(Boolean)])) : []; }
export function isAllowedModel(modelId: unknown): modelId is string { return typeof modelId === "string" && allowedModels().includes(modelId); }
