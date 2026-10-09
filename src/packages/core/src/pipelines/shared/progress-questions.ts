import type { ChoiceQuestions, DecisionChoices } from "../../decision/choose";
import type { ProgressEvidence } from "./progress-evidence";

export function buildProgressQuestions(evidence: ProgressEvidence, continuation = false): ChoiceQuestions {
  return {
    contentState: { type: "choice", instructions: "Assess current target content (or whole deliverable when no target). Ignore TODO completion claims as proof. Distinguish a finished item with stale progress from an unwritten remainder.",
      criteria: { unfinished: "Specific business content remains unwritten", complete: "Supplied business output completes the target", unknown: "Cannot verify from supplied evidence" } },
    reasonCode: { type: "choice", instructions: "Choose the evidence-based reason for the assessment; never interpret cropped or omitted output as absent output.", criteria: {
      requirements_met: "Requested deliverable is present", content_gap: "A specific requested part is missing in supplied complete evidence", progress_unsynced: "Business content and TODO disagree", repeated_output: "Repeated business output without progress", scope_conflict: "Intent requests another target while current remains unfinished", length_deviation: "A stated length requirement is violated", evidence_insufficient: "Supplied evidence cannot establish completion",
    } },
    evidenceRef: { type: "choice", instructions: "Select the supplied output supporting your assessment. all_provided references only the actually supplied excerpts, never omitted text.",
      criteria: { none: "No supplied output supports the assessment", all_provided: "Multiple supplied output excerpts support it", ...Object.fromEntries(evidence.outputRefs.map(output => [output.ref, `Supplied output ${output.ref}`])) } },
    ...(continuation ? { intentScope: { type: "choice" as const,
      instructions: "Compare intent.nextPrompt to currentTodo. Which task does the Agent request continuing? A request to skip the current item or execute another TODO is other, even if current content is unfinished. No intent means none.",
      criteria: { current: "Remainder of current target", other: "Another task, or skip current target", none: "No explicit intent", unknown: "Cannot reliably determine the requested scope" },
    } } : {}),
  };
}

export function readProgressAssessment(choices: DecisionChoices) {
  return Object.fromEntries(Object.entries(choices).filter(([key]) => key !== "continuation" && key !== "status" && key !== "behavior").map(([key, value]) => [key, value.choice]));
}
