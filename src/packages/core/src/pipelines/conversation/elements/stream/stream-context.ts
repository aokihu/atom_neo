import { BusEvents } from "@atom-neo/shared";
import type { ContextSnapshot, ContextOwner, TodoItem, ToolContextInjection } from "@atom-neo/shared";
import type { ContextService } from "@core/context/context-service";
import type { ElementTask, PipelineSession } from "@core/session/element-session";
import type { SkillServiceLike } from "@core/skills/types";
import { injectToolContext } from "./stream-model-input";
import type { DomainEmitter, StepContextLike, StreamReporter } from "./types";

/**
 * Owns the per-step Context snapshot lifecycle: refresh, usage commit, release,
 * tool-context injection, skill/todo change detection, and StepCompleted.
 */
export class StepContextController implements StepContextLike {
  #contextService: ContextService;
  #session?: PipelineSession;
  #task: ElementTask;
  #contextOwner?: ContextOwner;
  #snapshotBudget: number;
  #skillService?: SkillServiceLike;
  #report: StreamReporter;
  #emitDomain: DomainEmitter;
  #skillRevision: number;
  #todoState: string;
  #contextDirty = false;
  #currentSnapshot?: ContextSnapshot;
  #systemText: string;

  constructor(params: {
    contextService: ContextService;
    session?: PipelineSession;
    task: ElementTask;
    contextOwner?: ContextOwner;
    contextSnapshot?: ContextSnapshot;
    snapshotBudget: number;
    skillService?: SkillServiceLike;
    systemText: string;
    report: StreamReporter;
    emitDomain: DomainEmitter;
  }) {
    this.#contextService = params.contextService;
    this.#session = params.session;
    this.#task = params.task;
    this.#contextOwner = params.contextOwner;
    this.#snapshotBudget = params.snapshotBudget;
    this.#skillService = params.skillService;
    this.#report = params.report;
    this.#emitDomain = params.emitDomain;
    this.#currentSnapshot = params.contextSnapshot;
    this.#systemText = params.systemText;
    this.#skillRevision = this.#skillService?.getRevision?.(this.#session?.sessionId) ?? 0;
    this.#todoState = JSON.stringify(this.#session?.todoState ?? []);
  }

  get systemText(): string {
    return this.#systemText;
  }

  get currentSnapshotId(): string | undefined {
    return this.#currentSnapshot?.id;
  }

  get dirty(): boolean {
    return this.#contextDirty;
  }

  refresh(stepNumber: number): void {
    const nextRevision = this.#skillService?.getRevision?.(this.#session?.sessionId) ?? 0;
    const nextTodos = JSON.stringify(this.#session?.todoState ?? []);
    const skillChanged = nextRevision !== this.#skillRevision;
    const todosChanged = nextTodos !== this.#todoState;
    if (!skillChanged && !todosChanged && !this.#contextDirty) return;
    const refreshReason = { skillChanged, todosChanged, contextChanged: this.#contextDirty };
    this.#todoState = nextTodos;
    this.#contextDirty = false;
    this.#skillRevision = nextRevision;
    const skillContext = skillChanged ? this.#skillService?.buildContext(this.#session?.sessionId) ?? "" : "";
    const owner = {
      sessionId: this.#session?.sessionId ?? this.#task.sessionId ?? "default",
      ...(this.#session?.currentTopic ? { topicId: this.#session.currentTopic } : {}),
    };
    const scope = this.#session?.currentTopic ? "topic" as const : "session" as const;
    if (skillChanged && skillContext) {
      this.#contextService.put({
        scope,
        owner,
        entry: {
          key: "topic-skills",
          format: "text",
          source: "skill-service",
          channel: "instructions",
          trust: "trusted",
          priority: 600,
          content: skillContext,
        },
      });
    } else if (skillChanged) {
      this.#contextService.remove(scope, owner, "topic-skills");
    }
    if (todosChanged) {
      const taskOwner = { ...owner, taskId: this.#task.id ?? "task" };
      const state = this.#contextService.get("task", taskOwner, "task-state");
      if (state) {
        const { revision: _revision, ...entry } = state;
        this.#contextService.put({ scope: "task", owner: taskOwner,
        entry: { ...entry, content: { ...(state.content as Record<string, unknown>),
          todos: this.#session?.todoState ?? [] } } });
      }
    }
    const stepSnapshot = this.#contextService.createSnapshot({
      ...this.#contextOwner,
      stepId: String(stepNumber),
      inputBudget: this.#snapshotBudget,
    });
    this.#systemText = stepSnapshot.content;
    if (this.#currentSnapshot) this.#contextService.releaseSnapshot(this.#currentSnapshot.id);
    this.#currentSnapshot = stepSnapshot;
    this.#report(BusEvents.Element.Data, {
      step: "step-snapshot-created",
      stepNumber,
      snapshotId: stepSnapshot.id,
      revision: nextRevision,
      skillContextLength: skillContext.length,
      refreshReason,
      inputBudget: this.#snapshotBudget,
    });
  }

  commit(failed: boolean, timedOut: boolean, signal: AbortSignal): void {
    if (this.#currentSnapshot && !failed && !timedOut && !signal.aborted) {
      if (this.#contextService.commitSnapshot(this.#currentSnapshot.id) > 0) this.#contextDirty = true;
    }
  }

  release(): void {
    if (this.#currentSnapshot) this.#contextService.releaseSnapshot(this.#currentSnapshot.id);
  }

  inject(injection: ToolContextInjection, stepNumber: number, toolName: string): {
    scope: ToolContextInjection["scope"];
    key: string;
  } {
    this.#contextDirty = true;
    const scope = injectToolContext({
      contextService: this.#contextService,
      injection,
      sessionId: this.#session?.sessionId ?? this.#task.sessionId ?? "default",
      topicId: this.#session?.currentTopic || undefined,
      contextOwner: this.#contextOwner,
      stepId: String(stepNumber),
    });
    this.#report(BusEvents.Element.Data, {
      step: "tool-context-injected",
      toolName,
      scope,
      key: injection.entry.key,
    });
    return { scope, key: injection.entry.key };
  }

  completeStep(stepNumber: number): void {
    this.#emitDomain(BusEvents.Context.StepCompleted, {
      sessionId: this.#session?.sessionId ?? this.#task.sessionId ?? "default",
      taskId: this.#task.id ?? "task",
      stepId: String(stepNumber),
    });
  }
}
