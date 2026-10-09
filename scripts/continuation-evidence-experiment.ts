import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { callJev } from "../src/packages/core/src/decision/jev-client";
import { buildAssistantReview } from "../src/packages/core/src/pipelines/post-conversation/elements/collect-input";
import { buildProgressEvidence, createProgressTrace, getProgressFacts } from "../src/packages/core/src/pipelines/shared/progress-evidence";
import { buildProgressQuestions } from "../src/packages/core/src/pipelines/shared/progress-questions";

const args = process.argv.slice(2);
const option = (key: string, fallback: string) => args[args.indexOf(key) + 1] && args.includes(key) ? args[args.indexOf(key) + 1]! : fallback;
const root = option("--output", "/tmp/atom-evidence");
mkdirSync(root, { recursive: true });
const replayFile = option("--replay", "");
const replay = replayFile ? JSON.parse(readFileSync(replayFile, "utf8")) : undefined;
const source = option("--source", "/tmp/atom-continuation-live-n_q6cx3j");
const repetitions = Number(option("--repeats", "3"));
const arms = option("--arms", "baseline,evidence_only,full").split(",");
const config = JSON.parse(readFileSync("sandbox/config.json", "utf8"));
const profile = config.providerProfiles.fast;
const providerId = profile.slice(0, profile.indexOf("/"));
const provider = config.providers[providerId];
const model = profile.slice(profile.indexOf("/") + 1);
const apiKey = process.env[provider.apiKeyEnv];
if (!apiKey || provider.type !== "jev") throw new Error("Configured native JEV credentials required");
const baselineQuestions = replay?.baselineQuestions ?? JSON.parse(readFileSync(join(root, "baseline-questions.json"), "utf8"));
const visible = (file: string) => replay ? [] : JSON.parse(readFileSync(join(source, file), "utf8")).filter((m: any) => m.role === "assistant" && m.visible !== false);
const world = visible("world-civilization-messages.json");
const story = visible("no-todo-long-messages.json");
const todo = (content: string, status = "completed") => ({ content, status, priority: "high" });
const plan = [todo("文明起源"), todo("古典文明"), todo("近代与当代")];
const target = { index: 0, content: "文明起源" };
const tagged = world.map((part: any, index: number) => ({ ...part, metadata: { ...part.metadata, progress: {
  target: { index: Math.max(0, index - 1), content: plan[Math.max(0, index - 1)].content },
  before: "in_progress", after: index === 0 ? "in_progress" : "completed", terminalCause: index === 0 ? "intent_segment" : "todo_handoff",
} } }));
const history = tagged.slice(0, 1);
const pending = [todo("文明起源", "in_progress"), todo("古典文明", "pending"), todo("近代与当代", "pending")];
const worldGoal = "写世界文明简史，必须包括文明起源、古典文明、近代与当代三个部分，每部分有标题和实质正文，不要求字数。";
let cases: any[] = [
  { id: "world_complete", purpose: "post", goal: worldGoal, parts: tagged, todos: plan, expected: "satisfactory" },
  { id: "world_missing_middle", purpose: "post", goal: worldGoal, parts: tagged.filter((_p: any, i: number) => i !== 2), todos: plan, expected: "blocked" },
  { id: "world_missing_end", purpose: "post", goal: worldGoal, parts: tagged.slice(0, 3), todos: plan, expected: "blocked" },
  { id: "story_complete", purpose: "post", goal: "写一篇海港城市旅行故事，结尾必须是‘他终于回到了灯火中的港口。’。", parts: story, todos: [], expected: "satisfactory" },
  { id: "story_missing_ending", purpose: "post", goal: "写一篇海港城市旅行故事，结尾必须是‘他终于回到了灯火中的港口。’。", parts: story.map((p: any) => ({ ...p, content: p.content.replace("他终于回到了灯火中的港口。", "") })), todos: [], expected: "blocked" },
  { id: "promise_only", purpose: "post", goal: worldGoal, parts: [{ content: "我会完成文明起源、古典文明、近代与当代三个部分。" }], todos: plan, expected: "blocked" },
  { id: "stale_progress", purpose: "continuation", goal: "先写文明起源的实质正文，再写古典文明、近代与当代。", parts: history, current: tagged[1], todos: pending, target, expected: "reconcile_progress" },
  { id: "valid_segment", purpose: "continuation", goal: "文明起源要包括农业、文字、国家、法律和跨区域交流，当前分段尚未写国家、法律和交流。", parts: [], current: tagged[0], todos: pending, target, intent: { summary: "已写农业与文字", nextPrompt: "继续当前文明起源的国家、法律和交流", avoidRepeat: "农业与文字" }, expected: "resume_current" },
  { id: "skip_current", purpose: "continuation", goal: "必须先完成文明起源的农业、文字、国家、法律和交流，再写古典文明。", parts: [], current: tagged[0], todos: pending, target, intent: { summary: "只写了起源前半", nextPrompt: "跳过文明起源，直接写下一项古典文明", avoidRepeat: "" }, expected: "reconcile_progress" },
  { id: "repeated_current", purpose: "continuation", goal: "先完成文明起源：农业、文字、国家、法律和交流，不重复段落。", parts: history, current: tagged[0], todos: pending, target, expected: "reconcile_progress" },
  { id: "strict_length_holdout", purpose: "post", goal: "写文明起源简史，正文严格不超过200个汉字。", parts: [tagged[0]], todos: [], expected: "blocked", holdout: true },
  { id: "short_complete_holdout", purpose: "post", goal: "用一句话说明文字对文明发展的作用。", parts: [{ content: "文字让知识和制度可以跨越世代积累与传播。" }], todos: [], expected: "satisfactory", holdout: true },
  { id: "short_unfinished_holdout", purpose: "continuation", goal: "写一个海港故事，要求最后一句是‘旅行结束了。’，现在还没有写完。", parts: [], current: { content: "他走进海港，看见" }, todos: [], intent: { summary: "开头", nextPrompt: "继续故事直至旅行结束了。", avoidRepeat: "开头" }, expected: "resume_current", holdout: true },
  { id: "gate_english_complete", gate: true, purpose: "post", goal: "Write two short sections titled Agriculture and Writing, explaining one social effect of each.", parts: [{ seq: 11, content: "## Agriculture\nFarming supported permanent villages and a division of labor." }, { seq: 12, content: "## Writing\nRecords allowed laws and knowledge to persist beyond a speaker's lifetime." }], todos: [todo("Agriculture"), todo("Writing")], expected: "satisfactory" },
  { id: "gate_english_missing", gate: true, purpose: "post", goal: "Write two short sections titled Agriculture and Writing, explaining one social effect of each.", parts: [{ seq: 11, content: "## Agriculture\nFarming supported permanent villages and a division of labor." }], todos: [todo("Agriculture"), todo("Writing")], expected: "blocked" },
  { id: "gate_stale_complete", gate: true, purpose: "continuation", goal: "Write one sentence explaining how farming enabled settled villages; then separately explain writing.", parts: [], current: { content: "Farming produced a steady food supply that let people establish permanent villages." }, todos: [todo("Explain settled villages", "in_progress"), todo("Explain writing", "pending")], target: { index: 0, content: "Explain settled villages" }, expected: "reconcile_progress" },
  { id: "gate_valid_intent", gate: true, purpose: "continuation", goal: "In the agriculture section explain food supply and division of labor. Then write a writing section.", parts: [], current: { content: "Farming gave villages a steady food supply." }, todos: [todo("Agriculture: food supply and division of labor", "in_progress"), todo("Writing", "pending")], target: { index: 0, content: "Agriculture: food supply and division of labor" }, intent: { summary: "Food supply covered", nextPrompt: "Continue agriculture by explaining division of labor", avoidRepeat: "food supply" }, expected: "resume_current" },
  { id: "gate_skip_intent", gate: true, purpose: "continuation", goal: "Finish agriculture: food supply and division of labor before moving to writing.", parts: [], current: { content: "Farming gave villages a steady food supply." }, todos: [todo("Agriculture: food supply and division of labor", "in_progress"), todo("Writing", "pending")], target: { index: 0, content: "Agriculture: food supply and division of labor" }, intent: { summary: "Food supply covered", nextPrompt: "Skip division of labor and start the writing section", avoidRepeat: "food supply" }, expected: "reconcile_progress" },
];
if (replay) cases = replay.cases;
writeFileSync(join(root, "fixtures.json"), JSON.stringify({ note: "Saved text with explicitly derived goals/negative controls; TODO associations added from known prior trace, not original message metadata", cases }, null, 2));
const snapshotFile = join(root, "full-evidence.json");
const snapshot = replay?.snapshot ?? (existsSync(snapshotFile) ? JSON.parse(readFileSync(snapshotFile, "utf8")) : Object.fromEntries(cases.map(item => {
  const evidence = evidenceFor(item);
  return [item.id, { evidence, questions: buildProgressQuestions(evidence) }];
})));
for (const item of cases.filter(item => !snapshot[item.id])) {
  const evidence = evidenceFor(item);
  snapshot[item.id] = { evidence, questions: buildProgressQuestions(evidence, item.purpose === "continuation") };
}
writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
if (arms.some(arm => ["full", "core", "core_units", "core_repeat", "jev_heavy", "semantic_only"].includes(arm))
  && !snapshot.world_complete?.evidence.outputUnits) throw new Error("Frozen full-parameter snapshot required; use --replay with the experiment artifact");

function evidenceFor(item: any) {
  const trace = item.purpose === "continuation" ? createProgressTrace({ currentTodo: item.target, todoBefore: item.todos,
    finishReason: item.intent ? "tool-calls" : "stop", intents: item.intent ? [{ request: "follow_up" }] : [] }, item.todos) : undefined;
  return buildProgressEvidence({ parts: item.parts, current: item.current, todos: item.todos, goal: item.goal, before: item.todos, trace });
}
function reducedEvidence(evidence: any, arm: string) {
  if (arm === "full") return evidence;
  if (arm === "semantic_only") return undefined;
  const keep = ["target", "todoSnapshot", "outputRefs", "todoTransition", "terminalCause", "reviewCoverage"];
  if (arm === "core_units") keep.push("outputUnits", "lengthConstraint");
  if (arm === "core_repeat") keep.push("repeatEvidence", "continuationStats");
  if (arm === "jev_heavy") return { target: evidence.target, outputRefs: evidence.outputRefs, reviewCoverage: evidence.reviewCoverage,
    todoSnapshot: evidence.todoSnapshot, terminalCause: evidence.terminalCause };
  return Object.fromEntries(keep.map(key => [key, evidence[key]]));
}
function legacyReview(item: any) {
  const parts = item.parts;
  const chars = parts.reduce((n: number, p: any) => n + p.content.length, 0);
  if (chars + parts.length - 1 <= 2400 && item.todos.length === 0) return parts.map((p: any) => p.content).join("\n");
  const counts = Object.fromEntries(["completed", "in_progress", "pending", "cancelled"].map(s => [s, item.todos.filter((t: any) => t.status === s).length]));
  const last = parts.at(-1)?.content ?? "";
  return `[Response State] parts=${parts.length}, chars=${chars}, finishReason=tool-calls, completeDetected=false\n[TODO State] ${Object.entries(counts).map(([k,v])=>`${k}=${v}`).join(", ")}\n[Response Head]\n${(parts[0]?.content ?? "").slice(0,700)}\n[Response Tail]\n${last.slice(-1300)}`;
}
const records: any[] = [];
const jobs = cases.filter(c => args.includes("--gate") ? c.gate : args.includes("--holdout") ? c.holdout : !c.holdout && !c.gate).flatMap(item => arms.flatMap(arm => Array.from({ length: repetitions }, (_v, repeat) => ({ item, arm, repeat }))));
// Interleave variants, fixed corpus, bounded concurrency; every timeout is a recorded failure.
let index = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (index < jobs.length) {
    const { item, arm, repeat } = jobs[index++];
    const evidence = arm === "final" ? evidenceFor(item) : snapshot[item.id].evidence;
    const enhanced = !["baseline", "evidence_only"].includes(arm);
    const judgments = option("--judgments", "full");
    const addedQuestions = Object.fromEntries(Object.entries(snapshot[item.id].questions).filter(([id]) => judgments === "full"
      || (judgments === "no_remainder" ? id !== "remainder" : ["contentState", "reasonCode", "evidenceRef"].includes(id))));
    const questions: any = { ...baselineQuestions[item.purpose], ...(enhanced ? arm === "final" ? buildProgressQuestions(evidence, item.purpose === "continuation") : addedQuestions : {}) };
    if (enhanced && judgments === "scoped" && item.purpose === "continuation") questions.intentScope = {
      type: "choice", instructions: "Compare intent.nextPrompt to currentTodo. Which task does the Agent request continuing? A request to skip the current item or execute another TODO is other, even if current content is unfinished. No intent means none.",
      criteria: { current: "Remainder of current target", other: "Another task, or skip current target", none: "No explicit intent", unknown: "Cannot reliably determine the requested scope" },
    };
    const state: any = item.purpose === "post" ? {
      userMessage: item.goal, assistantResponse: arm === "baseline" ? legacyReview(item) : buildAssistantReview(item.parts, item.todos, item.goal).response,
      taskIntent: "creative", assistantParts: item.parts.length, assistantLength: item.parts.reduce((n: number,p:any)=>n+p.content.length,0),
      activeTodoCount: item.todos.filter((t:any)=>["pending","in_progress"].includes(t.status)).length,
      finishReason: "tool-calls", completeDetected: false, toolEffectSummary: { evidence: 0, referenceEvidence: 0, stateChanged: item.todos.length, none: 0, failed: 0 },
    } : { userGoal: { text: item.goal, truncated: false }, todoBefore: item.todos, todoAfter: item.todos, currentTodo: item.target,
      finishReason: item.intent ? "tool-calls" : "stop", completeDetected: false, intent: item.intent,
      response: { text: item.current.content, truncated: false }, history: item.parts.map((p:any)=>({text:p.content,truncated:false})) };
    if (arm === "final") {
      state.progressEvidence = getProgressFacts(evidence);
      if (item.purpose === "continuation") {
        state.incomingContinuation = undefined;
        state.repeatedOutput = !!item.current.content && item.current.content.length >= 100 && item.parts.slice(-2).some((part: any) => part.content.trim() === item.current.content.trim());
        state.response = evidence.outputRefs.find((part: any) => part.ref === "current");
        state.history = evidence.outputRefs.filter((part: any) => part.ref !== "current");
      }
    } else if (enhanced && arm !== "semantic_only") state.progressEvidence = reducedEvidence(evidence, arm);
    const started = performance.now();
    const record: any = { case: item.id, arm, repeat, judgments, expected: item.expected, inputChars: JSON.stringify({state,questions}).length };
    try {
      const result = await callJev({ apiKey, endpoint: provider.baseUrl, model, state, questions, abortSignal: AbortSignal.timeout(10_000) });
      record.answers = result.answers; record.usage = result.usage;
      const answer = (id:string)=> (result.answers[id] as any)?.choice;
      record.raw = answer(item.purpose === "post" ? "status" : "continuation");
      record.final = record.raw;
      if (enhanced && item.purpose === "post" && record.raw === "satisfactory"
        && (state.activeTodoCount > 0 || (questions.coverage && answer("coverage") !== "met") || answer("contentState") !== "complete" || ["partial_work","no_output"].includes(answer("behavior")) || answer("evidenceRef") === "none")) record.final = "blocked";
      if (enhanced && item.purpose === "continuation" && record.raw === "resume_current"
        && (state.repeatedOutput || answer("contentState") !== "unfinished" || (arm !== "final" && ["scope_conflict","repeated_output"].includes(answer("reasonCode")))
          || (questions.intentScope && item.intent && answer("intentScope") !== "current"))) record.final = "reconcile_progress";
      if (item.purpose === "continuation" && ["finish","advance_todo"].includes(record.raw)) record.final = "reconcile_progress";
      record.pass = record.final === item.expected;
    } catch (error) { record.error = String(error); record.pass = false; }
    record.elapsedMs = Math.round(performance.now() - started);
    records.push(record);
    writeFileSync(join(root, `${option("--name", "initial")}-results.json`), JSON.stringify(records, null, 2));
    console.log(JSON.stringify({ case: record.case, arm, repeat, pass: record.pass, raw: record.raw, final: record.final, elapsedMs: record.elapsedMs, error: record.error }));
  }
}));
console.log(JSON.stringify(Object.fromEntries(arms.map(arm => { const rows = records.filter(r=>r.arm===arm);return [arm,{pass:rows.filter(r=>r.pass).length,total:rows.length,errors:rows.filter(r=>r.error).length,meanInputChars:Math.round(rows.reduce((n,r)=>n+r.inputChars,0)/rows.length)}]; })),null,2));
