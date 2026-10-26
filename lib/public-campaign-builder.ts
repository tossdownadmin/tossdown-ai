// The standalone campaign builder is intentionally accessible without Tossdown login.
// Keep a single actor for Redis approvals and a shared rate-limit bucket so
// anonymous visitors cannot bypass limits by choosing a new identity.
export const PUBLIC_CAMPAIGN_BUILDER_ACTOR = "public-campaign-builder";
