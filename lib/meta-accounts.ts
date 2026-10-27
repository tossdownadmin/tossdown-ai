import { directGraphRequest, directMetaConfiguration, publicMetaError } from "./meta-direct";

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
export type SharedMetaAccount = { id: string; name?: string; currency?: string };

export async function listSharedMetaAccounts() {
  if (!directMetaConfiguration().configured) return { configured: false, accounts: [] as SharedMetaAccount[], graphError: "missing_configuration" as const, truncated: false };

  const accounts: SharedMetaAccount[] = [];
  const seenCursors = new Set<string>();
  let after = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ fields: "id,name,currency", limit: String(PAGE_SIZE) });
    if (after) query.set("after", after);
    let payload: Record<string, unknown>;
    try {
      payload = await directGraphRequest(`/me/adaccounts?${query}`, { signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      const details = publicMetaError(error);
      return { configured: true, accounts, graphError: details?.code === 190 ? "permission_error" as const : "graph_api_error" as const, truncated: accounts.length > 0 };
    }
    if (!Array.isArray(payload.data)) return { configured: true, accounts, graphError: "graph_api_error" as const, truncated: accounts.length > 0 };
    for (const value of payload.data) {
      if (!value || typeof value !== "object" || typeof value.id !== "string" || !/^(?:act_)?[0-9]{1,30}$/.test(value.id)) continue;
      accounts.push({ id: value.id, name: typeof value.name === "string" ? value.name.slice(0, 200) : undefined, currency: typeof value.currency === "string" ? value.currency.slice(0, 20) : undefined });
    }
    const paging = payload.paging as { next?: unknown; cursors?: { after?: unknown } } | undefined;
    if (!paging?.next) return { configured: true, accounts, graphError: null, truncated: false };
    const cursor = paging.cursors?.after;
    if (typeof cursor !== "string" || !cursor || seenCursors.has(cursor)) return { configured: true, accounts, graphError: null, truncated: true };
    seenCursors.add(cursor);
    after = cursor;
  }
  return { configured: true, accounts, graphError: null, truncated: true };
}
