# tossdown AI

Internal marketing chat for verified `@tossdown.com` employees. The MVP uses Next.js App Router, Auth.js Google sign-in, Amazon Bedrock ConverseStream, Upstash Redis rate limiting, and Vercel OIDC for short-lived AWS credentials.

## Local startup

1. Install Node.js 20+ and run `npm install`.
2. Copy `.env.example` to `.env.local`; fill in the values below. Never commit `.env.local`.
3. Configure Google OAuth (next section), then run `npm run dev`.
4. For a local-only UI demo, set `MOCK_MODE=true`; the UI labels every mock response and this mode is rejected in production.

## Required configuration

- `AUTH_SECRET`: `openssl rand -base64 32`.
- `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`: a Google OAuth Web application client. Add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI. Add the deployed URL plus `/api/auth/callback/google` after Vercel creates the domain. Restrict the OAuth consent audience as appropriate for your Workspace.
- `BEDROCK_MODEL_ID`: in AWS Console, open Amazon Bedrock > Playgrounds > Chat, select the Claude Sonnet 4.6 model/profile that successfully worked, then copy the exact Model ID or inference profile ID shown in the model selector/details panel. Do not infer or substitute an ID. This value is server-only.
- `AWS_REGION=eu-north-1`.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: create a Redis database in Upstash and copy its REST connection values. The app fails closed when rate limiting is absent.
- `AWS_ROLE_ARN`: the IAM role created below; only needed for Vercel OIDC. Local development uses the standard AWS SDK credential chain if this is omitted.

## Vercel and GitHub

Import `tossdownadmin/tossdown-ai` in Vercel, select the Next.js framework, and add the environment variables in Project Settings > Environment Variables for Development, Preview, and Production as needed. Deployments are then triggered by pushes to GitHub. Do not provision paid services or promote Production until reviewed.

## AWS OIDC setup

Vercel's current official AWS OIDC flow uses `@vercel/oidc-aws-credentials-provider` and `AWS_ROLE_ARN`. In Vercel Project Settings > Security > Secure backend access with OIDC federation, choose Team issuer mode and note your team slug. Create an AWS IAM OpenID Connect provider with URL `https://oidc.vercel.com/TEAM_SLUG` and audience `https://vercel.com/TEAM_SLUG`. Create a role using `infra/trust-policy.json`, replacing every `REPLACE_*` value; its `sub` condition is restricted to this project and preview/production environments. Attach `infra/bedrock-policy.json` after replacing the exact model/profile ARN and any required destination model ARNs. Copy the resulting role ARN to Vercel as `AWS_ROLE_ARN`.

If the selected identifier is a cross-region inference profile, the policy must include `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` on the inference profile ARN plus the exact destination foundation-model ARNs listed by AWS for that profile. Keep the list exact and least-privilege; never use `Resource: "*"`.

## Verification

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. Local checks cover auth/domain/request validation/rate-limit behavior without contacting AWS. A real Bedrock response, model access, IAM permissions, Google OAuth callback, Vercel OIDC exchange, and Upstash connectivity still require the configuration above.

The app intentionally does not include n8n, agents, files, browsing, admin tools, or deployment automation in this MVP.

Official references: [Vercel AWS OIDC](https://vercel.com/docs/oidc/aws), [Vercel OIDC reference](https://vercel.com/docs/oidc/reference), [AWS Bedrock ConverseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html).
