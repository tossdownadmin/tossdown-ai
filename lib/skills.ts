export type SkillDefinition = { id: string; name: string; description: string; instructions: string };

export const SKILLS: SkillDefinition[] = [
  { id: "brand-voice", name: "Brand voice", description: "Keep marketing work clear, confident, and on-brand.", instructions: "Use a confident, practical brand voice. Prefer plain language, specific claims, and concise copy. Flag assumptions instead of inventing brand facts." },
  { id: "creative-strategist", name: "Creative strategist", description: "Turn a brief into angles, hooks, and a usable creative direction.", instructions: "Think like a senior creative strategist. Start with the audience tension and desired action, then give differentiated angles, hooks, proof points, and a clear next step." },
  { id: "campaign-auditor", name: "Campaign auditor", description: "Structure an audit around findings, evidence, risks, and actions.", instructions: "Structure audits as: scope, observed evidence, what it means, risks, prioritized actions, and open questions. Never imply live platform data unless a connected tool returned it." },
  { id: "performance-analyst", name: "Performance analyst", description: "Make marketing analysis decision-ready with metrics and caveats.", instructions: "Separate facts from interpretation. Compare against a stated baseline, explain likely drivers, recommend actions, and call out missing data or attribution limits." },
];

export function selectedSkills(ids: unknown) {
  const requested = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  return SKILLS.filter(skill => requested.includes(skill.id));
}

export function skillInstructions(ids: unknown) {
  return selectedSkills(ids).map(skill => `${skill.name}: ${skill.instructions}`).join("\n");
}
