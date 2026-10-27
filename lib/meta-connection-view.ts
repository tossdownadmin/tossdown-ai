export type AdConnection = {
  id: "google_ads" | "meta_ads";
  label: string;
  status: string;
  allowlistReady?: boolean;
  missing?: string[];
  tools?: Array<{ name: string }>;
  discoveryTruncated?: boolean;
};

export function withSharedMetaAccess(connections: AdConnection[], available: boolean): AdConnection[] {
  if (!available) return connections;
  const base = connections.some(connection => connection.id === "meta_ads") ? connections :
    [...connections, { id: "meta_ads" as const, label: "Meta Ads", status: "configured", allowlistReady: true }];
  return base.map(connection => connection.id === "meta_ads" ? { ...connection, status: "configured", allowlistReady: true } : connection);
}
