import type { TaskQueue } from "../task-queue";

let startTime = Date.now();

export function healthHandler(taskQueue: TaskQueue): Response {
  return Response.json({
    status: "ok",
    uptime: Math.round((Date.now() - startTime) / 1000),
    queue: {
      waiting: taskQueue.waiting,
      processing: taskQueue.processing,
    },
  });
}

export function metricsHandler(taskQueue: TaskQueue): Response {
  return Response.json({
    uptime: Math.round((Date.now() - startTime) / 1000),
    queue: { waiting: taskQueue.waiting, processing: taskQueue.processing },
    memory: process.memoryUsage(),
  });
}
