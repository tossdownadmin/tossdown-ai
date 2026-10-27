import { directGraphRequest, directMetaConfiguration, publicMetaError } from "./meta-direct";
import { listSharedMetaAccounts } from "./meta-accounts";

const AUDIT_LIMIT = 40;

export function validMetaAccountId(value: string) {
  return /^(?:act_)?[0-9]{1,30}$/.test(value);
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function stringField(value: unknown) {
  return typeof value === "string" ? value.slice(0, 200) : undefined;
}

export async function auditSelectedMetaAccount(accountId: string) {
  if (!directMetaConfiguration().configured) return { ok: false as const, error: "Shared Meta access is not configured." };
  if (!validMetaAccountId(accountId)) return { ok: false as const, error: "Select a valid Meta ad account." };

  const readiness = await listSharedMetaAccounts();
  const account = readiness.accounts.find(item => item.id.replace(/^act_/, "") === accountId.replace(/^act_/, ""));
  if (!account) return { ok: false as const, error: "The selected account is not accessible to the shared Meta connection." };

  const id = `act_${account.id.replace(/^act_/, "")}`;
  try {
    const [campaignPayload, insightPayload] = await Promise.all([
      directGraphRequest(`/${id}/campaigns?fields=id,name,objective,status,effective_status,created_time,updated_time&limit=${AUDIT_LIMIT}`, { signal: AbortSignal.timeout(10_000) }),
      directGraphRequest(`/${id}/insights?fields=campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,reach,frequency&level=campaign&date_preset=last_30d&limit=${AUDIT_LIMIT}`, { signal: AbortSignal.timeout(10_000) }),
    ]);
    const campaignRows = rows(campaignPayload.data);
    const insightRows = rows(insightPayload.data);
    const campaigns = campaignRows.slice(0, AUDIT_LIMIT).map(item => ({
      id: stringField(item.id), name: stringField(item.name), objective: stringField(item.objective),
      status: stringField(item.status), effectiveStatus: stringField(item.effective_status),
      createdTime: stringField(item.created_time), updatedTime: stringField(item.updated_time),
    }));
    const insights = insightRows.slice(0, AUDIT_LIMIT).map(item => ({
      campaignId: stringField(item.campaign_id), campaignName: stringField(item.campaign_name),
      spend: stringField(item.spend), impressions: stringField(item.impressions), clicks: stringField(item.clicks),
      ctr: stringField(item.ctr), cpc: stringField(item.cpc), reach: stringField(item.reach), frequency: stringField(item.frequency),
    }));
    return {
      ok: true as const,
      source: "Meta Marketing API (shared system-user token)",
      account: { id: account.id, name: account.name, currency: account.currency },
      period: "last_30d",
      campaigns,
      insights,
      truncated: Boolean(campaignRows.length > AUDIT_LIMIT || insightRows.length > AUDIT_LIMIT || (campaignPayload.paging as { next?: unknown } | undefined)?.next || (insightPayload.paging as { next?: unknown } | undefined)?.next),
      note: "Read-only sample. If truncated, do not claim this is a complete account audit. Metrics are Meta-reported and may not match external analytics.",
    };
  } catch (error) {
    const details = publicMetaError(error);
    const message = details?.code === 190 ? "The shared Meta token was rejected. Ask an administrator to check it." :
      details?.code === 200 || details?.code === 10 ? "Meta denied read access to this account. Ask an administrator to check ads_read permission." :
      "Meta account data could not be read right now. Try again or ask an administrator to check the connection.";
    return { ok: false as const, error: message };
  }
}
