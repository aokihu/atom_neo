import type { PipelineRecorder, RecordedEvent } from "./recorder";
import type { PipelineEventBus } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";

export class PipelinePlayer {
  #recorder: PipelineRecorder;
  #bus: PipelineEventBus<FullEventMap>;

  constructor(params: {
    recorder: PipelineRecorder;
    bus: PipelineEventBus<FullEventMap>;
  }) {
    this.#recorder = params.recorder;
    this.#bus = params.bus;
  }

  async play(taskId: string): Promise<void> {
    const events = this.#recorder.getEvents(taskId);
    if (events.length === 0) return;

    this.#bus.emit("event.pipeline.replay-start" as any, {
      taskId,
      eventCount: events.length,
    });

    for (const event of events) {
      this.#bus.emit(event.type as any, event.payload);
    }

    this.#bus.emit("event.pipeline.replay-end" as any, {
      taskId,
      durationMs: 0,
    });
  }

  async playAll(): Promise<void> {
    for (const taskId of this.#recorder.getAllTaskIds()) {
      await this.play(taskId);
    }
  }
}
