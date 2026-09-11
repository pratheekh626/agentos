import { LiveEventStream, type StreamEvent } from "./index";
import { LiveEventBridge } from "./bridge";
import { EventBus } from "../../messaging/EventBus";
import type { AgentRuntimeEvents } from "../../agents/Runtime";
import type { Task } from "../../core/Task";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ── TEST 1: Event normalization, unique IDs, timestamp & payload ──────────────
{
  const stream = new LiveEventStream();
  const evt1 = stream.publish({
    eventType: "TASK_CREATED",
    timestamp: "2026-09-11T00:00:00.000Z",
    projectId: "proj-1",
    taskId: "task-1",
    agentId: "worker-1",
    actorId: "boss-1",
    payload: { title: "Test task" },
    visibility: "public",
  });

  assert(evt1.eventId.startsWith("evt-"), "Event ID should be generated");
  assert(evt1.eventType === "TASK_CREATED", "Event type mismatch");
  assert(evt1.timestamp === "2026-09-11T00:00:00.000Z", "Timestamp mismatch");
  assert(evt1.projectId === "proj-1", "Project ID mismatch");
  assert(evt1.taskId === "task-1", "Task ID mismatch");
  assert(evt1.agentId === "worker-1", "Agent ID mismatch");
  assert(evt1.actorId === "boss-1", "Actor ID mismatch");
  assert(evt1.payload.title === "Test task", "Payload mismatch");
  assert(evt1.visibility === "public", "Visibility mismatch");
}
console.log("TEST 1 passed: Event normalization, IDs, and fields");

// ── TEST 2: Unique event IDs generation across sequential calls ──────────────
{
  const stream = new LiveEventStream();
  const e1 = stream.publish({ eventType: "EVT_A" });
  const e2 = stream.publish({ eventType: "EVT_B" });
  assert(e1.eventId !== e2.eventId, "Event IDs must be unique");
}
console.log("TEST 2 passed: Unique event IDs");

// ── TEST 3: Ordering preservation ─────────────────────────────────────────────
{
  const stream = new LiveEventStream();
  stream.publish({ eventType: "FIRST", timestamp: "2026-09-11T00:00:01.000Z" });
  stream.publish({ eventType: "SECOND", timestamp: "2026-09-11T00:00:02.000Z" });
  stream.publish({ eventType: "THIRD", timestamp: "2026-09-11T00:00:03.000Z" });

  const recent = stream.getRecent();
  assert(recent.length === 3, "Expected 3 events");
  assert(recent[0].eventType === "FIRST", "Order violation");
  assert(recent[1].eventType === "SECOND", "Order violation");
  assert(recent[2].eventType === "THIRD", "Order violation");
}
console.log("TEST 3 passed: Ordering preservation");

// ── TEST 4: Bounded history capacity ─────────────────────────────────────────
{
  const stream = new LiveEventStream({ maxCapacity: 3 });
  stream.publish({ eventType: "E1" });
  stream.publish({ eventType: "E2" });
  stream.publish({ eventType: "E3" });
  assert(stream.getEventCount() === 3, "Capacity should be 3");

  stream.publish({ eventType: "E4" });
  assert(stream.getEventCount() === 3, "Capacity should remain bounded at 3");
  const recent = stream.getRecent();
  assert(recent[0].eventType === "E2", "Oldest event E1 should have been evicted");
  assert(recent[2].eventType === "E4", "Newest event should be E4");
}
console.log("TEST 4 passed: Bounded history capacity");

// ── TEST 5: Filtering by projectId, taskId, agentId, and eventType ────────────
{
  const stream = new LiveEventStream();
  stream.publish({ eventType: "TYPE_A", projectId: "p1", taskId: "t1", agentId: "a1" });
  stream.publish({ eventType: "TYPE_B", projectId: "p1", taskId: "t2", agentId: "a2" });
  stream.publish({ eventType: "TYPE_A", projectId: "p2", taskId: "t1", agentId: "a1" });

  assert(stream.getByProject("p1").length === 2, "Expected 2 events for p1");
  assert(stream.getByTask("t1").length === 2, "Expected 2 events for t1");
  assert(stream.getByAgent("a1").length === 2, "Expected 2 events for a1");
  assert(stream.getByType("TYPE_A").length === 2, "Expected 2 events for TYPE_A");
}
console.log("TEST 5 passed: Multi-criteria filtering");

// ── TEST 6: Subscriptions, unsubscriptions & multiple subscribers ─────────────
{
  const stream = new LiveEventStream();
  const sub1Events: StreamEvent[] = [];
  const sub2Events: StreamEvent[] = [];

  const unsubscribe1 = stream.subscribe((e) => sub1Events.push(e));
  const unsubscribe2 = stream.subscribe((e) => sub2Events.push(e));

  assert(stream.getSubscriberCount() === 2, "Expected 2 subscribers");

  stream.publish({ eventType: "MSG_1" });
  assert(sub1Events.length === 1, "Sub1 should receive event 1");
  assert(sub2Events.length === 1, "Sub2 should receive event 1");

  unsubscribe1();
  assert(stream.getSubscriberCount() === 1, "Expected 1 subscriber after unsubscribe");

  stream.publish({ eventType: "MSG_2" });
  assert(sub1Events.length === 1, "Sub1 should not receive after unsubscribe");
  assert((sub2Events.length as number) === 2, "Sub2 should continue to receive");

  unsubscribe2();
  assert(stream.getSubscriberCount() === 0, "Expected 0 subscribers after all unsubscribe");
}
console.log("TEST 6 passed: Subscription/unsubscription and multiple subscribers");

// ── TEST 7: No mutation of source event or task state ─────────────────────────
{
  const stream = new LiveEventStream();
  const originalTask: Task = {
    id: "task-readonly",
    title: "Readonly",
    description: "Readonly task",
    assignedTo: "worker-1",
    createdBy: "boss-1",
    status: "in_progress",
    priority: "high",
    dependencies: [],
    budget: 100,
    spent: 0,
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
  };

  const copy = { ...originalTask };
  stream.publish({
    eventType: "TASK_STARTED",
    taskId: originalTask.id,
    agentId: originalTask.assignedTo,
    payload: { task: originalTask },
  });

  assert(JSON.stringify(originalTask) === JSON.stringify(copy), "Source task object must not be mutated");
}
console.log("TEST 7 passed: No mutation of source state");

// ── TEST 8: Real EventBus integration via LiveEventBridge ────────────────────
{
  const stream = new LiveEventStream();
  const runtimeBus = new EventBus<AgentRuntimeEvents>();
  const bridge = new LiveEventBridge(stream, { runtimeEvents: runtimeBus });

  const dummyTask: Task = {
    id: "t-bus",
    title: "Bus Task",
    description: "Descr",
    assignedTo: "worker-bus",
    createdBy: "boss-bus",
    status: "queued",
    priority: "medium",
    dependencies: [],
    budget: 0,
    spent: 0,
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
  };

  runtimeBus.emit("task.created", dummyTask);

  const events = stream.getByType("TASK_CREATED");
  assert(events.length === 1, "Bridge should normalize task.created event");
  assert(events[0].taskId === "t-bus", "Bridge should map taskId correctly");
  assert(events[0].actorId === "boss-bus", "Bridge should map actorId correctly");

  bridge.disconnect();
}
console.log("TEST 8 passed: Real EventBus integration");

console.log("\n✅ All LiveEventStream unit tests passed.");
