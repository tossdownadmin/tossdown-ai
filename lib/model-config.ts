// Reviewed against the account's positive Anthropic quotas in eu-north-1
// (27 Oct 2026) and the exact global inference-profile IDs shown in Bedrock.
// A quota is not proof of IAM/model access; live invocation still needs testing.
export const QUOTA_CONFIRMED_MODELS = [
  "global.anthropic.claude-sonnet-4-6",
  "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "global.anthropic.claude-haiku-4-5-20251001-v1:0",
  "global.anthropic.claude-opus-4-6-v1",
  "global.anthropic.claude-opus-4-5-20251101-v1:0",
] as const;

const quotaConfirmed = new Set<string>(QUOTA_CONFIRMED_MODELS);

export function allowedModels(): string[] {
  const defaultModel = process.env.BEDROCK_MODEL_ID?.trim();
  // Fail closed instead of silently changing the default when it is not one
  // of the reviewed inference profiles.
  if (!defaultModel || !quotaConfirmed.has(defaultModel)) return [];

  const additional = (process.env.BEDROCK_MODEL_IDS || "")
    .split(",")
    .map(model => model.trim())
    .filter(model => quotaConfirmed.has(model));
  return Array.from(new Set([defaultModel, ...additional]));
}

export function isAllowedModel(modelId: unknown): modelId is string {
  return typeof modelId === "string" && allowedModels().includes(modelId);
}
