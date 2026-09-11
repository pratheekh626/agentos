import { LiveEventStream } from "../LiveEventStream";
import {
  ClientMonitoringService,
  type ClientAuthContext,
  type ClientSafeEvent,
} from "./index";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log("Running ClientMonitoringService Unit Tests...\n");

// Setup sample auth contexts
const authClientA: ClientAuthContext = {
  clientId: "client-alpha",
  authorizedProjectIds: ["proj-alpha"],
};

const authClientB: ClientAuthContext = {
  clientId: "client-beta",
  authorizedProjectIds: ["proj-beta"],
};

const unauthorizedClient: ClientAuthContext = {
  clientId: "client-unauth",
  authorizedProjectIds: [],
};

// ── TEST 1: Authorized client can view project activity ──────────────────────
{
  const stream = new LiveEventStream();
  const service = new ClientMonitoringService(stream);
  service.registerProjectTask("proj-alpha", "task-alpha-1");

  stream.publish({
    eventType: "TASK_CREATED",
    taskId: "task-alpha-1",
    payload: { title: "Alpha Task 1" },
    visibility: "public",
  });

  const activity = service.getProjectActivity(authClientA, "proj-alpha");
  assert(activity.length === 1, "Authorized client should view project activity");
  assert(activity[0].projectId === "proj-alpha", "Event project ID should match");
  assert(activity[0].eventType === "TASK_CREATED", "Event type should match");
}
console.log("TEST 1 passed: Authorized client can view project activity");

// ── TEST 2: Unauthorized client cannot view project activity ──────────────────
{
  const stream = new LiveEventStream();
  const service = new ClientMonitoringService(stream);
  service.registerProjectTask("proj-alpha", "task-alpha-1");

  stream.publish({
    eventType: "TASK_CREATED",
    taskId: "task-alpha-1",
    payload: { title: "Alpha Task 1" },
    visibility: "public",
  });

  const activity = service.getProjectActivity(unauthorizedClient, "proj-alpha");
  assert(activity.length === 0, "Unauthorized client must receive no activity");
}
console.log("TEST 2 passed: Unauthorized client cannot view project activity");

// ── TEST 3: Unknown project is rejected / returns no data ────────────────────
{
  const stream = new LiveEventStream();
  const service = new ClientMonitoringService(stream);

  const activity = service.getProjectActivity(authClientA, "proj-unknown");
  assert(activity.length === 0, "Unknown project must return empty array");
}
console.log("TEST 3 passed: Unknown project is rejected / returns no data");

// ── TEST 4 & 5: Client receives only client-safe events; internal events excluded ──
{
  const stream = new LiveEventStream();
  const service = new ClientMonitoringService(stream);
  service.registerProjectTask("proj-alpha", "task-alpha-1");

  // Public safe event
  stream.publish({
    eventType: "TASK_STARTED",
    taskId: "task-alpha-1",
    agentId: "worker-1",
    payload: { riskScore: 0.99, identityFingerprint: "secret-fp", status: "in_progress" },
    visibility: "public",
  });

  // Internal governance / A2A event
  stream.publish({
    eventType: "A2A_MESSAGE",
    taskId: "task-alpha-1",
    agentId: "worker-1",
    payload: { content: "internal raw text" },
    visibility: "internal",
  });

  // Internal recovery event
  stream.publish({
    eventType: "RECOVERY_ATTEMPTED",
    taskId: "task-alpha-1",
    payload: { action: "retry" },
    visibility: "internal",
  });

  const activity = service.getProjectActivity(authClientA, "proj-alpha");
  assert(activity.length === 1, "Only client-safe public event should be included");
  assert(activity[0].eventType === "TASK_STARTED", "Should be TASK_STARTED");

  // Verify payload sanitization
  assert(!("riskScore" in activity[0].payload), "riskScore must be sanitized out");
  assert(!("identityFingerprint" in activity[0].payload), "identityFingerprint must be sanitized out");
  assert(activity[0].payload.status === "in_progress", "Safe status payload should remain");
}
console.log("TEST 4 & 5 passed: Client receives only client-safe events; internal events excluded");

// ── TEST 6 & 7: Project filtering and Task filtering ─────────────────────────
{
  const stream = new LiveEventStream();
  const service = new ClientMonitoringService(stream);
  service.registerProjectTask("proj-alpha", "task-alpha-1");
  service.registerProjectTask("proj-alpha", "task-alpha-2");

  stream.publish({ eventType: "TASK_CREATED", taskId: "task-alpha-1", visibility: "public" });
  stream.publish({ eventType: "TASK_CREATED", taskId: "task-alpha-2", visibility: "public" });

  const projectEvents = service.getProjectActivity(authClientA, "proj-alpha");
  assert(projectEvents.length === 2, "Project filtering should return all project events");

  const task1Events = service.getTaskActivity(authClientA, "proj-alpha", "task-alpha-1");
  assert(task1Events.length === 1, "Task filtering should return only task-1 events");
  assert(task1Events[0].taskId === "task-alpha-1", "TaskId must match filter");
}
console.log("TEST 6 & 7 passed: Project filtering and task filtering");

// ── TEST 8: Event ordering is preserved ──────────────────────────────────────
{
  const stream = new LiveEventStream();
  const service = new ClientMonitoringService(stream);
  service.registerProjectTask("proj-alpha", "task-alpha-1");

  stream.publish({ eventType: "TASK_CREATED", taskId: "task-alpha-1", timestamp: "2026-09-11T10:00:00Z", visibility: "public" });
  stream.publish({ eventType: "TASK_STARTED", taskId: "task-alpha-1", timestamp: "2026-09-11T10:01:00Z", visibility: "public" });
  stream.publish({ eventType: "TASK_COMPLETED", taskId: "task-alpha-1", timestamp: "2026-09-11T10:02:00Z", visibility: "public" });

  const activity = service.getProjectActivity(authClientA, "proj-alpha");
  assert(activity.length === 3, "All 3 events returned");
  assert(activity[0].eventType === "TASK_CREATED", "Order 1: TASK_CREATED");
  assert(activity[1].eventType === "TASK_STARTED", "Order 2: TASK_STARTED");
  assert(activity[2].eventType === "TASK_COMPLETED", "Order 3: TASK_COMPLETED");
}
console.log("TEST 8 passed: Event ordering is preserved");

// ── TEST 9 & 10: Subscription receives client-safe events & Unsubscribe ──────
{
  const stream = new LiveEventStream();
  const service = new ClientMonitoringService(stream);
  service.registerProjectTask("proj-alpha", "task-alpha-1");

  const receivedEvents: ClientSafeEvent[] = [];
  const unsubscribe = service.subscribeToProject(authClientA, "proj-alpha", (event) => {
    receivedEvents.push(event);
  });

  stream.publish({ eventType: "TASK_CREATED", taskId: "task-alpha-1", visibility: "public" });
  assert(receivedEvents.length === 1, "Subscriber should receive event");

  // Publish internal event - should be ignored by subscriber
  stream.publish({ eventType: "ESCALATION_CREATED", taskId: "task-alpha-1", visibility: "internal" });
  assert(receivedEvents.length === 1, "Subscriber should NOT receive internal event");

  unsubscribe();
  stream.publish({ eventType: "TASK_COMPLETED", taskId: "task-alpha-1", visibility: "public" });
  assert(receivedEvents.length === 1, "Subscriber should NOT receive after unsubscribe");
}
console.log("TEST 9 & 10 passed: Subscription receives client-safe events & Unsubscribe works");

// ── TEST 11: Source LiveEventStream state is not mutated ─────────────────────
{
  const stream = new LiveEventStream();
  const service = new ClientMonitoringService(stream);
  service.registerProjectTask("proj-alpha", "task-alpha-1");

  stream.publish({ eventType: "TASK_CREATED", taskId: "task-alpha-1", visibility: "public" });

  const initialStreamCount = stream.getEventCount();
  const activity = service.getProjectActivity(authClientA, "proj-alpha");
  activity[0].summary = "Mutated summary!";

  assert(stream.getEventCount() === initialStreamCount, "Stream event count must be unchanged");
  const reFetch = service.getProjectActivity(authClientA, "proj-alpha");
  assert(reFetch[0].summary !== "Mutated summary!", "Internal state must remain immutable");
}
console.log("TEST 11 passed: Source LiveEventStream state is not mutated");

// ── TEST 12: No fabricated events ───────────────────────────────────────────
{
  const stream = new LiveEventStream();
  const service = new ClientMonitoringService(stream);
  service.registerProjectTask("proj-alpha", "task-alpha-1");

  const activity = service.getProjectActivity(authClientA, "proj-alpha");
  assert(activity.length === 0, "No events should exist if none were published to stream");
}
console.log("TEST 12 passed: No fabricated events");

// ── TEST 13: Multiple clients have isolated authorization ────────────────────
{
  const stream = new LiveEventStream();
  const service = new ClientMonitoringService(stream);
  service.registerProjectTask("proj-alpha", "task-alpha-1");
  service.registerProjectTask("proj-beta", "task-beta-1");

  stream.publish({ eventType: "TASK_CREATED", taskId: "task-alpha-1", visibility: "public" });
  stream.publish({ eventType: "TASK_CREATED", taskId: "task-beta-1", visibility: "public" });

  const alphaActivity = service.getProjectActivity(authClientA, "proj-alpha");
  const alphaBetaTry = service.getProjectActivity(authClientA, "proj-beta");
  const betaActivity = service.getProjectActivity(authClientB, "proj-beta");

  assert(alphaActivity.length === 1 && alphaActivity[0].taskId === "task-alpha-1", "Client A sees proj-alpha");
  assert(alphaBetaTry.length === 0, "Client A cannot see proj-beta");
  assert(betaActivity.length === 1 && betaActivity[0].taskId === "task-beta-1", "Client B sees proj-beta");
}
console.log("TEST 13 passed: Multiple clients have isolated authorization");

console.log("\n✅ All ClientMonitoringService unit tests passed.");
