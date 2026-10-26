type FormIds = {
  accountId: string; objective: string; pixelId: string; assetMode: string;
  pageId: string; instagramActorId: string; accountImageHash: string; existingCreativeId: string;
};
type CreatedIds = { campaignId?: string; adSetId?: string; imageHash?: string; creativeId?: string; adId?: string };

export function campaignIdSummary(fields: FormIds, created: CreatedIds | null) {
  const rows: Array<[string, string | undefined]> = [
    ["Ad account ID", fields.accountId],
    ["Meta Pixel ID", fields.objective === "OUTCOME_SALES" ? fields.pixelId : ""],
    ["Facebook Page ID", fields.assetMode !== "EXISTING_CREATIVE" ? fields.pageId : ""],
    ["Instagram actor ID", fields.assetMode !== "EXISTING_CREATIVE" ? fields.instagramActorId : ""],
    ["Existing creative ID", fields.assetMode === "EXISTING_CREATIVE" ? fields.existingCreativeId : ""],
    ["Account image hash", fields.assetMode === "ACCOUNT_IMAGE" ? fields.accountImageHash : ""],
    ["Campaign ID", created?.campaignId],
    ["Ad set ID", created?.adSetId],
    ["Uploaded image hash", created?.imageHash],
    ["New creative ID", created?.creativeId],
    ["Ad ID", created?.adId],
  ];
  return rows.filter((row): row is [string, string] => Boolean(row[1]));
}
