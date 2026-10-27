"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { signIn, signOut, useSession } from "next-auth/react";
import { completedMessages, requestMessages } from "../lib/chat-client";
import { withSharedMetaAccess, type AdConnection } from "../lib/meta-connection-view";

type Activity = { label: string; ok?: boolean };
type Message = { role: "user" | "assistant"; content: string; activity?: Activity[] };
type Connection = AdConnection;
type Account = { id: string; name?: string };
type DirectMetaStatus = { configured: boolean; available: boolean; truncated: boolean };
type Skill = { id: string; name: string; description: string };
type ChatSummary = { id: string; title: string; updatedAt: string; modelId: string; skillIds: string[] };
type StreamEvent = { type: string; text?: string; name?: string; ok?: boolean; error?: string; failureCode?: string };

const starters = [
  { label: "Write ad copy", prompt: "Write three distinct paid-social ad concepts for " },
  { label: "Create a brief", prompt: "Create a concise creative brief for " },
  { label: "Build a plan", prompt: "Build a practical 90-day marketing plan for " },
  { label: "Audit a campaign", prompt: "Audit the selected ad account and identify the highest-impact opportunities. Use live connected data only." },
];

const previewChats: ChatSummary[] = [
  { id: "sample-1", title: "Spring campaign performance", updatedAt: new Date().toISOString(), modelId: "global.anthropic.claude-sonnet-4-6", skillIds: [] },
  { id: "sample-2", title: "Restaurant launch ideas", updatedAt: new Date().toISOString(), modelId: "global.anthropic.claude-sonnet-4-6", skillIds: [] },
  { id: "sample-3", title: "Weekly marketing plan", updatedAt: new Date().toISOString(), modelId: "global.anthropic.claude-sonnet-4-6", skillIds: [] },
];
const previewMessages: Message[] = [
  { role: "user", content: "Review our spring campaign and tell me what to improve first." },
  { role: "assistant", content: "Here is where I would start:\n\n### Review delivery first\nCheck where spend is concentrated, then compare the ads receiving that spend.\n\n1. Find campaigns with limited delivery.\n2. Refresh ads showing creative fatigue.\n\nConnect an ad account for an evidence-based audit.", activity: [{ label: "Sample tool activity", ok: true }] },
];

function modelName(id: string) {
  if (!id) return "Choose a model";
  const value = id.toLowerCase();
  const family = /claude-(sonnet|opus|haiku|fable)-(\d+)(?:-(\d+))?/.exec(value);
  if (family) return "Claude " + family[1][0].toUpperCase() + family[1].slice(1) + " " + family[2] + (family[3] ? "." + family[3] : "");
  return id.split("/").pop()?.replace(/^(global|eu|us|apac)\./, "").replace(/[._-]/g, " ") || "Bedrock model";
}

function Icon({ name }: { name: "menu" | "plus" | "close" | "send" | "copy" | "spark" | "search" | "sliders" | "chevron" }) {
  const path = {
    menu: "M4 6h16M4 12h16M4 18h16",
    plus: "M12 5v14M5 12h14",
    close: "M6 6l12 12M18 6 6 18",
    send: "M5 12h14m-6-6 6 6-6 6",
    copy: "M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2M6 8H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2",
    spark: "m12 2 2.1 7.9L22 12l-7.9 2.1L12 22l-2.1-7.9L2 12l7.9-2.1L12 2Z",
    search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm6-2 4 4",
    sliders: "M4 7h16M4 17h16M9 4v6m6 4v6",
    chevron: "m7 10 5 5 5-5",
  }[name];
  return <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;
}

export default function Chat() {
  const { data: session, status: authStatus } = useSession();
  const [previewMode, setPreviewMode] = useState(false);
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [modelId, setModelId] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [enabledConnections, setEnabledConnections] = useState<string[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [directMetaStatus, setDirectMetaStatus] = useState<DirectMetaStatus | null>(null);
  const [accountError, setAccountError] = useState("");
  const [accountLoading, setAccountLoading] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [retryPrompt, setRetryPrompt] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState("");
  const [popover, setPopover] = useState<"tools" | "skills" | null>(null);
  const abort = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const savedSnapshot = useRef("");

  useEffect(() => {
    if (process.env.NODE_ENV === "development" && new URLSearchParams(window.location.search).get("preview") === "1") {
      setPreviewMode(true);
      setCurrentChatId("sample-1");
      setMessages(previewMessages);
      setModelId("global.anthropic.claude-sonnet-4-6");
    } else {
      setCurrentChatId(crypto.randomUUID());
    }
    fetch("/api/config").then(response => response.json()).then(data => {
      setModels(data.models || []);
      if (new URLSearchParams(window.location.search).get("preview") !== "1") setModelId(data.models?.[0] || "");
      setSkills(data.skills || []);
    }).catch(() => undefined);
    fetch("/api/connections").then(async response => {
      const data = await response.json();
      setMcpEnabled(response.status === 401 || Boolean(data.enabled));
      if (response.ok) setConnections(data.connections || []);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!session?.user || previewMode) return;
    fetch("/api/chats").then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Saved chats are unavailable.");
      setChats(data.chats || []);
      setHistoryError("");
    }).catch(reason => setHistoryError(reason instanceof Error ? reason.message : "Saved chats are unavailable."));
  }, [session?.user, previewMode]);

  useEffect(() => {
    if (!session?.user || previewMode || !messages.length || busy || !currentChatId || !models.includes(modelId)) return;
    const durableMessages = error && messages.at(-1)?.role === "assistant" ? messages.slice(0, -1) : messages;
    const stored = completedMessages(durableMessages);
    if (!stored.length) return;
    const snapshot = JSON.stringify({ id: currentChatId, stored, modelId, skillIds });
    if (snapshot === savedSnapshot.current) return;
    const timer = window.setTimeout(() => {
      fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: currentChatId, messages: stored.slice(-24), modelId, skillIds }),
      }).then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "This chat could not be saved.");
        savedSnapshot.current = snapshot;
        setChats(current => [data.chat, ...current.filter(chat => chat.id !== data.chat.id)]);
        setHistoryError("");
      }).catch(reason => setHistoryError(reason instanceof Error ? reason.message : "This chat could not be saved."));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [messages, busy, error, currentChatId, modelId, models, skillIds, session?.user, previewMode]);

  useEffect(() => {
    if (previewMode || !session?.user) return;
    void loadAccounts();
  }, [session?.user, previewMode]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 240) + "px";
  }, [input]);

  useEffect(() => {
    if (previewMode) {
      scrollRef.current?.scrollTo({ top: 0 });
      return;
    }
    if (messages.length) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: busy ? "instant" : "smooth" });
  }, [messages, busy, previewMode]);

  async function loadAccounts() {
    setAccountLoading(true);
    setAccountError("");
    try {
      const response = await fetch("/api/meta/direct/status");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Meta accounts are unavailable.");
      setAccounts(data.accounts || []);
      setDirectMetaStatus({ configured: Boolean(data.configured), available: Boolean(data.available), truncated: Boolean(data.truncated) });
      if (!data.configured) setAccountError("Shared Meta access is not configured.");
      else if (!data.available) setAccountError(data.graphError ? "Meta could not load the shared ad accounts. Ask an administrator to check the token and permissions." : "No ad accounts are accessible to the shared Meta token.");
    } catch (reason) {
      setDirectMetaStatus(null);
      setAccounts([]);
      setAccountError(reason instanceof Error ? reason.message : "Meta accounts are unavailable.");
    } finally {
      setAccountLoading(false);
    }
  }

  async function send(prompt = input, retry = false) {
    if (!prompt.trim() || busy || previewMode) return;
    if (!models.includes(modelId)) {
      setError(models.length ? "Choose an available model before sending." : "No quota-confirmed model is configured. Ask an administrator to update the Bedrock model settings.");
      return;
    }
    const previous = retry && messages.at(-1)?.role === "assistant" && messages.at(-2)?.role === "user" ? messages.slice(0, -2) : messages;
    const next: Message[] = [...previous.filter(message => message.content.trim()), { role: "user", content: prompt.trim() }];
    setMessages([...next, { role: "assistant", content: "", activity: [] }]);
    setInput("");
    setError("");
    setRetryPrompt("");
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    let content = "";
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: requestMessages(next), modelId, enabledConnections, skillIds, selectedAccountId }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Unable to send message.");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("The response was empty.");
      const decoder = new TextDecoder();
      let buffer = "";
      const processLine = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as StreamEvent;
        if (event.type === "text") {
          content += event.text || "";
          setMessages(current => current.map((message, index) => index === current.length - 1 ? { ...message, content } : message));
        }
        if (event.type === "tool_start" || event.type === "tool_result") {
          setMessages(current => current.map((message, index) => index === current.length - 1 ? {
            ...message,
            activity: [...(message.activity || []), { label: (event.type === "tool_start" ? "Using " : "") + (event.name || "tool") + (event.type === "tool_result" && event.failureCode ? ` · ${event.failureCode}` : ""), ok: event.type === "tool_result" ? event.ok : undefined }],
          } : message));
        }
        if (event.type === "error") {
          setError(event.error || "Generation failed.");
          setRetryPrompt(prompt);
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      }
      buffer += decoder.decode();
      if (buffer) processLine(buffer);
    } catch (reason) {
      if ((reason as Error).name === "AbortError") {
        setError("Generation stopped. Your prompt is saved.");
        setRetryPrompt(prompt);
      } else {
        setError(reason instanceof Error ? reason.message : "Generation failed.");
        setRetryPrompt(prompt);
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  async function openChat(id: string) {
    if (previewMode) {
      setCurrentChatId(id);
      setMessages(id === "sample-1" ? previewMessages : [{ role: "user", content: "Plan our next campaign." }, { role: "assistant", content: "This is a **sample conversation** for reviewing the layout. Real chats appear here after sign-in and server storage are configured." }]);
      setDrawer(false);
      return;
    }
    try {
      const response = await fetch("/api/chats?id=" + encodeURIComponent(id));
      const data = await response.json();
      if (!response.ok || !data.chat) throw new Error(data.error || "This chat could not be opened.");
      savedSnapshot.current = JSON.stringify({ id: data.chat.id, stored: data.chat.messages, modelId: data.chat.modelId, skillIds: data.chat.skillIds || [] });
      setMessages(data.chat.messages);
      setCurrentChatId(data.chat.id);
      setModelId(data.chat.modelId);
      setSkillIds(data.chat.skillIds || []);
      setError("");
      setDrawer(false);
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : "This chat could not be opened.");
    }
  }

  function newChat() {
    setMessages([]);
    setCurrentChatId(previewMode ? null : crypto.randomUUID());
    savedSnapshot.current = "";
    setInput("");
    setError("");
    setModelId(displayModels[0] || "");
    setDrawer(false);
    composerRef.current?.focus();
  }

  const displayChats = previewMode ? previewChats : chats;
  const displayModels = previewMode ? ["global.anthropic.claude-sonnet-4-6", "global.anthropic.claude-opus-4-6-v1", "global.anthropic.claude-haiku-4-5-20251001-v1:0"] : models;
  const unavailableModel = Boolean(modelId && !displayModels.includes(modelId));
  const displayConnections: Connection[] = previewMode ? [
    { id: "meta_ads", label: "Meta Ads", status: "configured", allowlistReady: true },
    { id: "google_ads", label: "Google Ads", status: "not_configured" },
  ] : withSharedMetaAccess(connections, Boolean(directMetaStatus?.available));
  const displayAccounts = previewMode ? [{ id: "sample-account", name: "Sample ad account" }] : accounts;
  const activeChat = displayChats.find(chat => chat.id === currentChatId);
  const visibleChats = displayChats.filter(chat => chat.title.toLowerCase().includes(search.toLowerCase()));
  const activeSkills = skills.filter(skill => skillIds.includes(skill.id));
  const meta = displayConnections.find(connection => connection.id === "meta_ads");
  const google = displayConnections.find(connection => connection.id === "google_ads");

  if (mcpEnabled && authStatus !== "authenticated" && !previewMode) {
    return <main className="auth-screen"><div className="auth-panel"><div className="brand">tossdown <span>AI</span></div>{authStatus === "loading" ? <p>Loading your workspace…</p> : <><h1>A better place to think about marketing.</h1><p>Sign in with your verified tossdown.com Google account to continue.</p><button className="solid-button" onClick={() => signIn("google", { callbackUrl: "/" })}>Sign in with Google</button></>}</div></main>;
  }

  return <main className="chat-app">
    {drawer && <button className="drawer-scrim" aria-label="Close chat history" onClick={() => setDrawer(false)} />}
    <aside className={"history-rail" + (drawer ? " rail-open" : "")}>
      <div className="rail-header"><div className="brand">tossdown <span>AI</span></div><button className="icon-btn mobile-only" onClick={() => setDrawer(false)} aria-label="Close menu"><Icon name="close" /></button></div>
      <div className="rail-actions"><button className="new-chat-btn" onClick={newChat}><Icon name="plus" /> New chat</button><label className="history-search"><Icon name="search" /><input aria-label="Search chats" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search chats" /></label></div>
      <div className="rail-history"><p className="rail-label">Your chats</p>{historyError && <p className="history-error" role="alert">{historyError}</p>}{visibleChats.length ? visibleChats.map(chat => <button key={chat.id} className={"history-item" + (chat.id === currentChatId ? " selected" : "")} onClick={() => openChat(chat.id)}><span>{chat.title}</span></button>) : <p className="history-empty">{search ? "No matching chats." : previewMode ? "No sample chats." : session?.user ? "No saved chats yet. Start a conversation." : "Sign in to see your saved chats."}</p>}</div>
      <div className="rail-profile">{previewMode ? <span className="preview-profile">Sample preview</span> : session?.user ? <><span className="profile-avatar">{(session.user.name || session.user.email || "T").slice(0, 1).toUpperCase()}</span><span className="profile-name">{session.user.name || session.user.email}</span><button className="text-button" onClick={() => signOut({ callbackUrl: "/" })}>Sign out</button></> : <button className="text-button" onClick={() => signIn("google", { callbackUrl: "/" })}>Sign in with Google</button>}</div>
    </aside>

    <section className="chat-main">
      {previewMode && <div className="preview-banner">UI preview · Sample chats and account · No live data or model calls</div>}
      <header className="chat-header">
        <button className="icon-btn mobile-only" onClick={() => setDrawer(true)} aria-label="Open chat history"><Icon name="menu" /></button>
        <div className="chat-heading"><strong>{activeChat?.title || "New conversation"}</strong><span>{previewMode ? "Sample workspace" : "Marketing workspace"}</span></div>
        <div className="header-controls">
          <label className="model-picker"><span className="sr-only">Model</span><select value={modelId} onChange={event => setModelId(event.target.value)} disabled={!displayModels.length}>{unavailableModel && <option value={modelId} disabled>Unavailable: {modelName(modelId)}</option>}{displayModels.length ? displayModels.map(model => <option key={model} value={model}>{modelName(model)}</option>) : <option value="">No quota-confirmed model</option>}</select><Icon name="chevron" /></label>
          <button className={"connection-pill" + (meta?.status === "configured" ? " connected" : "")} onClick={() => setPopover(popover === "tools" ? null : "tools")} aria-label="Meta Ads connection"><span className="pill-dot" /> Meta</button>
          <button className={"connection-pill" + (google?.status === "configured" ? " connected" : "")} onClick={() => setPopover(popover === "tools" ? null : "tools")} aria-label="Google Ads connection"><span className="pill-dot" /> Google</button>
        </div>
      </header>

      <div className="conversation-scroll" ref={scrollRef}>
        <div className="conversation-content">{unavailableModel && <div className="model-notice" role="status">This chat used {modelName(modelId)}, which is no longer available. Choose a model above to continue; your previous messages remain saved.</div>}{!displayModels.length && !previewMode && <div className="model-notice" role="status">No quota-confirmed model is configured. An administrator must set a supported inference profile before chat can run.</div>}{messages.length ? messages.map((message, index) => <article key={index} className={"chat-message " + message.role}>
          <div className="message-author">{message.role === "user" ? "You" : <><span className="assistant-mark"><Icon name="spark" /></span> tossdown AI</>}</div>
          <div className="message-content">{message.role === "user" ? <p>{message.content}</p> : <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: ({ children }) => <div className="table-scroll"><table>{children}</table></div> }}>{message.content}</ReactMarkdown>}</div>
          {message.role === "assistant" && message.activity?.length ? <details className="tool-activity"><summary>Activity · {message.activity.length} steps</summary>{message.activity.map((item, activityIndex) => <div key={activityIndex} className={item.ok === false ? "activity-failed" : ""}>{item.ok === false ? "!" : item.ok ? "✓" : "·"} {item.label}</div>)}</details> : null}
          {message.role === "assistant" && message.content && <button className="copy-action" onClick={() => navigator.clipboard.writeText(message.content)}><Icon name="copy" /> Copy</button>}
        </article>) : <div className="welcome-panel"><div className="welcome-symbol"><Icon name="spark" /></div><p className="welcome-overline">Your marketing workspace</p><h1>What can we work on?</h1><p className="welcome-subtitle">Ask a question, explore an idea, or bring in a connected account.</p><div className="starter-list">{starters.map(starter => <button key={starter.label} onClick={() => { setInput(starter.prompt); composerRef.current?.focus(); }}>{starter.label}<span>↗</span></button>)}</div></div>}
          {error && <div className="chat-error" role="alert"><span>{error}</span>{retryPrompt && <button onClick={() => send(retryPrompt, true)}>Retry</button>}</div>}
        </div>
      </div>

      <div className="composer-area">
        {popover && <div className="composer-popover">
          <div className="popover-head"><strong>{popover === "tools" ? "Connections" : "Skills"}</strong><button className="icon-btn" onClick={() => setPopover(null)} aria-label="Close panel"><Icon name="close" /></button></div>
          {popover === "tools" ? <div className="popover-body">{displayConnections.length ? displayConnections.map(connection => {
            const ready = connection.status === "configured" && connection.allowlistReady;
            const enabled = enabledConnections.includes(connection.id);
            return <div key={connection.id} className="tool-row"><div><strong>{connection.label}</strong><small>{ready && connection.id === "meta_ads" && directMetaStatus?.available ? "Shared account access · Read-only" : ready ? "Connected · Read-only" : connection.status === "disconnected" ? "Personal MCP disconnected" : "Not configured"}</small></div><label className="switch"><input type="checkbox" disabled={!ready || previewMode} checked={enabled} onChange={() => setEnabledConnections(current => enabled ? current.filter(id => id !== connection.id) : [...current, connection.id])} /><span className="sr-only">Use {connection.label} in this chat</span></label></div>;
          }) : <p className="muted-note">No ad connections configured.</p>}
          {(directMetaStatus?.configured || meta?.status === "configured" || previewMode) && <div className="account-control"><label htmlFor="meta-account">Meta ad account</label><div className="account-select-row"><select id="meta-account" value={selectedAccountId} onChange={event => {
            const account = displayAccounts.find(item => item.id === event.target.value);
            setSelectedAccountId(event.target.value);
            if (account && meta?.allowlistReady) setEnabledConnections(current => current.includes("meta_ads") ? current : [...current, "meta_ads"]);
            if (account) setInput(current => current.trim() ? current : "Audit Meta ad account " + (account.name || account.id) + " (" + account.id + "). Review campaign delivery, spend and performance, then build a prioritized action plan using live connected data only.");
          }} disabled={previewMode || !displayAccounts.length}><option value="">Choose an account</option>{displayAccounts.map(account => <option key={account.id} value={account.id}>{account.name || "Unnamed account"} · {account.id}</option>)}</select><button onClick={loadAccounts} disabled={accountLoading || previewMode}>{accountLoading ? "Loading" : "Refresh"}</button></div>{accountError && <p className="field-error">{accountError}</p>}{directMetaStatus?.truncated && <p className="muted-note">The account list is incomplete; ask an administrator if yours is missing.</p>}<p className="muted-note">Shared Meta accounts are available to signed-in tossdown employees. Audits are read-only; campaign changes still require separate approval.</p></div>}
          <details className="diagnostics"><summary>Connection details</summary>{displayConnections.map(connection => <p key={connection.id}>{connection.label}: {connection.status}{connection.missing?.length ? " · Missing " + connection.missing.join(", ") : ""}{connection.tools?.length ? " · " + connection.tools.length + " discovered tools" : ""}{connection.discoveryTruncated ? " · Discovery truncated" : ""}</p>)}</details>
          </div> : <div className="popover-body">{skills.length ? skills.map(skill => <label key={skill.id} className="skill-row"><input type="checkbox" checked={skillIds.includes(skill.id)} onChange={() => setSkillIds(current => current.includes(skill.id) ? current.filter(id => id !== skill.id) : [...current, skill.id])} /><span><strong>{skill.name}</strong><small>{skill.description}</small></span></label>) : <p className="muted-note">No shared skills configured.</p>}</div>}
        </div>}
        <div className="composer-shell"><textarea ref={composerRef} rows={2} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ask tossdown AI anything…" aria-label="Message" /><div className="composer-toolbar"><div className="composer-tools"><button className={"toolbar-btn" + (popover === "tools" ? " active" : "")} onClick={() => setPopover(popover === "tools" ? null : "tools")}><Icon name="sliders" /> Tools{enabledConnections.length ? <span className="toolbar-count">{enabledConnections.length}</span> : null}</button><button className={"toolbar-btn" + (popover === "skills" ? " active" : "")} onClick={() => setPopover(popover === "skills" ? null : "skills")}><Icon name="spark" /> Skills{activeSkills.length ? <span className="toolbar-count">{activeSkills.length}</span> : null}</button>{selectedAccountId && <span className="selected-account-chip">{displayAccounts.find(account => account.id === selectedAccountId)?.name || "Account selected"}</span>}</div>{busy ? <button className="stop-btn" onClick={() => abort.current?.abort()}>Stop</button> : <button className="send-btn" disabled={!input.trim() || previewMode || !displayModels.includes(modelId)} onClick={() => void send()} aria-label="Send message"><Icon name="send" /></button>}</div></div>
        <p className="composer-hint">{previewMode ? "Sample preview only · Sign in on the configured app to chat" : "Enter to send · Shift+Enter for a new line · AI can make mistakes"}</p>
      </div>
    </section>
  </main>;
}
