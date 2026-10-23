import { BedrockRuntimeClient, ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { LIMITS } from "./limits";

const system = "You are tossdown AI, an internal marketing assistant for tossdown employees. Be practical, clear, and honest. Help with ads, creative briefs, plans, and analysis. Do not claim access to live campaign data unless it is provided in the conversation. Keep recommendations concise and structured.";
function client() { const region = process.env.AWS_REGION || "eu-north-1"; return new BedrockRuntimeClient({ region, ...(process.env.AWS_ROLE_ARN ? { credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }) } : {}) }); }
export async function streamBedrock(messages: {role:"user"|"assistant";content:string}[]) {
  const modelId = process.env.BEDROCK_MODEL_ID;
  if (!modelId) throw new Error("BEDROCK_NOT_CONFIGURED");
  const command = new ConverseStreamCommand({ modelId, system: [{ text: system }], messages: messages.map(m => ({ role: m.role, content: [{ text: m.content }] })), inferenceConfig: { maxTokens: LIMITS.maxOutputTokens, temperature: 0.4 } });
  return client().send(command);
}
