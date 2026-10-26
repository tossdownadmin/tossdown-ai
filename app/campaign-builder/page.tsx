import { SessionProvider } from "next-auth/react";
import CampaignBuilder from "./campaign-builder";

export const metadata = { title: "Create paused campaign | tossdown AI" };

export default function CampaignBuilderPage() {
  return <SessionProvider><CampaignBuilder /></SessionProvider>;
}
