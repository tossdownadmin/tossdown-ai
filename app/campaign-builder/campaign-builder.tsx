"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

type Account = { id: string; name?: string; currency?: string };
type Created = { campaignId?: string; adSetId?: string; imageHash?: string; creativeId?: string; adId?: string };
const categories = [["", "None"], ["HOUSING", "Housing"], ["EMPLOYMENT", "Employment"], ["CREDIT", "Credit"], ["ISSUES_ELECTIONS_POLITICS", "Issues, elections or politics"], ["ONLINE_GAMBLING_AND_GAMING", "Online gambling and gaming"], ["FINANCIAL_PRODUCTS_SERVICES", "Financial products and services"]];
const initial = { accountId: "", name: "", objective: "OUTCOME_TRAFFIC", category: "", adSetName: "", dailyBudget: "", country: "PK", ageMin: "18", ageMax: "65", pixelId: "", creativeName: "", adName: "", pageId: "", instagramActorId: "", primaryText: "", headline: "", description: "", destinationUrl: "", callToAction: "LEARN_MORE" };

export default function CampaignBuilder() {
  const [accounts, setAccounts] = useState<Account[]>([]), [search, setSearch] = useState("");
  const [fields, setFields] = useState(initial), [image, setImage] = useState<File | null>(null);
  const [approvalId, setApprovalId] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [attempted, setAttempted] = useState(false);
  const [error, setError] = useState(""), [diagnostics, setDiagnostics] = useState<Record<string, string | number> | null>(null), [created, setCreated] = useState<Created | null>(null), [verified, setVerified] = useState(false);
  const filtered = useMemo(() => accounts.filter(account => `${account.name || ""} ${account.id}`.toLowerCase().includes(search.toLowerCase())), [accounts, search]);
  const selected = accounts.find(account => account.id === fields.accountId);
  useEffect(() => { fetch("/api/meta/direct/status").then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error); setAccounts(body.accounts || []); }).catch(reason => setError(reason instanceof Error ? reason.message : "Could not load accounts.")).finally(() => setLoading(false)); }, []);
  function update(name: keyof typeof initial, value: string) { setFields(current => ({ ...current, [name]: value })); setError(""); }
  const input = (name: keyof typeof initial, label: string, options: { type?: string; placeholder?: string; min?: string; max?: string; required?: boolean } = {}) => <label>{label}<input type={options.type || "text"} value={fields[name]} placeholder={options.placeholder} min={options.min} max={options.max} required={options.required ?? true} onChange={event => update(name, event.target.value)} /></label>;
  const select = (name: keyof typeof initial, label: string, values: string[][]) => <label>{label}<select value={fields[name]} onChange={event => update(name, event.target.value)}>{values.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>;
  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!image || !["image/jpeg", "image/png"].includes(image.type) || image.size > 8 * 1024 * 1024) { setError("Choose a JPEG or PNG image under 8 MB."); return; }
    setBusy(true); setError(""); setDiagnostics(null); setCreated(null); setVerified(false); setAttempted(false);
    try {
      const digest = await crypto.subtle.digest("SHA-256", await image.arrayBuffer());
      const imageDigest = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      const response = await fetch("/api/meta/direct/full/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...fields, specialAdCategories: fields.category ? [fields.category] : [], ageMin: Number(fields.ageMin), ageMax: Number(fields.ageMax), imageDigest, imageSize: image.size, imageType: image.type }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not prepare the package.");
      setApprovalId(body.approvalId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not prepare the package."); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!image || !approvalId || attempted || busy) return;
    setAttempted(true); setBusy(true); setError(""); setDiagnostics(null);
    const form = new FormData(); form.set("approvalId", approvalId); form.set("image", image);
    try {
      const response = await fetch("/api/meta/direct/full/execute", { method: "POST", body: form });
      const body = await response.json(); setCreated(Object.keys(body.created || {}).length ? body.created : null); setDiagnostics(body.diagnostics || null);
      if (!response.ok) throw new Error(body.error || "Meta could not create the package.");
      setVerified(body.verified === true); setApprovalId("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Request failed. Check Meta before submitting again; the result may be partial."); } finally { setBusy(false); }
  }
  function restart() { setApprovalId(""); setAttempted(false); setCreated(null); setVerified(false); setError(""); setDiagnostics(null); }
  return <main className="campaign-shell"><div className="campaign-card full-builder"><p className="eyebrow">Meta Marketing API</p><h1>Create paused campaign package</h1><p className="intro">Create a campaign, ad set, image creative, and ad. The campaign, ad set, and ad are paused. Meta may retain earlier objects if a later step fails.</p>
    {error && <div className="error" role="alert"><p>{error}</p>{diagnostics && <details open><summary>Safe Meta diagnostics</summary><dl>{Object.entries(diagnostics).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl></details>}</div>}
    {created && <section className={verified ? "success" : "partial"}><h2>{verified ? "All objects verified" : "Objects already created"}</h2><dl>{Object.entries(created).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>{!verified && <p>Check these IDs in Ads Manager before starting another package.</p>}<button type="button" onClick={restart}>Start a new package</button></section>}
    {!verified && !approvalId && <form onSubmit={prepare}><h2>1. Campaign</h2><label>Search ad accounts<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or account ID" /></label><label>Ad account<select required value={fields.accountId} onChange={event => update("accountId", event.target.value)} disabled={loading}><option value="">{loading ? "Loading…" : "Choose an account"}</option>{filtered.map(account => <option key={account.id} value={account.id}>{account.name || "Unnamed"} — {account.id}</option>)}</select></label>
      {input("name", "Campaign name")}{select("objective", "Objective", [["OUTCOME_TRAFFIC", "Traffic (link clicks)"], ["OUTCOME_SALES", "Sales (website purchases; Pixel required)"]])}{select("category", "Special ad category", categories)}
      <h2>2. Ad set</h2>{input("adSetName", "Ad set name")}{input("dailyBudget", `Daily budget in ${selected?.currency || "account currency"} minor units`, { type: "number", min: "1" })}{input("country", "Target country (two-letter code)", { max: "2" })}<div className="field-pair">{input("ageMin", "Minimum age", { type: "number", min: "18", max: "65" })}{input("ageMax", "Maximum age (65 means 65+)", { type: "number", min: "18", max: "65" })}</div>{fields.objective === "OUTCOME_SALES" && input("pixelId", "Meta Pixel ID for Purchase optimization")}
      <h2>3. Image creative and ad</h2>{input("creativeName", "Creative name")}{input("adName", "Ad name")}{input("pageId", "Facebook Page ID")}{input("instagramActorId", "Instagram actor ID (optional)", { required: false })}{input("primaryText", "Primary text")}{input("headline", "Headline")}{input("description", "Description (optional)", { required: false })}{input("destinationUrl", "Destination URL", { type: "url", placeholder: "https://example.com" })}{select("callToAction", "Call to action", [["LEARN_MORE", "Learn more"], ["SHOP_NOW", "Shop now"], ["SIGN_UP", "Sign up"]])}<label>Image (JPEG or PNG, up to 8 MB)<input type="file" accept="image/jpeg,image/png" required onChange={event => setImage(event.target.files?.[0] || null)} /></label><button disabled={busy || loading} type="submit">{busy ? "Preparing…" : "Review full package"}</button></form>}
    {!verified && approvalId && <section className="review"><p className="eyebrow">Review before confirmation · expires in 5 minutes</p><h2>{fields.name}</h2><dl><div><dt>Account</dt><dd>{selected?.name || fields.accountId} ({fields.accountId})</dd></div><div><dt>Objective</dt><dd>{fields.objective}</dd></div><div><dt>Special category</dt><dd>{fields.category || "None"}</dd></div><div><dt>Ad set</dt><dd>{fields.adSetName} · {fields.dailyBudget} minor units daily · {fields.country}, ages {fields.ageMin}–{fields.ageMax} · {fields.objective === "OUTCOME_SALES" ? "Purchase conversions" : "Link clicks"}</dd></div><div><dt>Creative</dt><dd>{fields.creativeName} · Page {fields.pageId} · {image?.name}</dd></div><div><dt>Ad</dt><dd>{fields.adName} · {fields.destinationUrl}</dd></div><div><dt>Delivery status</dt><dd>Campaign PAUSED · Ad set PAUSED · Ad PAUSED</dd></div></dl><button type="button" disabled={busy || attempted} onClick={confirm}>{busy ? "Creating…" : attempted ? "Submitted; check result" : "Confirm and create full paused package"}</button><button type="button" className="secondary" disabled={busy} onClick={restart}>Back to edit</button></section>}
  </div></main>;
}
