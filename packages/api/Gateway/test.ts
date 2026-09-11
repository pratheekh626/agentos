import { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { AgentRegistry } from "../../agents/AgentRegistry";
import { createBoss } from "../../agents/Boss";
import { createWorker } from "../../agents/Workers";
import { LiveEventStream } from "../../events/LiveEventStream";
import { ClientMonitoringService } from "../../events/ClientMonitoring";
import {
  ApiGatewayServer,
  HeaderDevAuthenticator,
  type ApiServicesContainer,
  type ApiResponseSuccess,
  type ApiResponseError,
} from "./index";
import type { Task } from "../../core/Task";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ── Mock HTTP Helper ─────────────────────────────────────────────────────────

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  json<T>(): T;
}

function makeMockReq(
  method: string,
  url: string,
  headers: Record<string, string> = {}
): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = { host: "localhost", ...headers };
  return req;
}

function makeMockRes(callback: (res: MockResponse) => void): ServerResponse {
  const res = new EventEmitter() as unknown as ServerResponse;
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let body = "";

  res.writeHead = (code: number, hdrs?: any) => {
    statusCode = code;
    if (hdrs) {
      for (const [k, v] of Object.entries(hdrs)) {
        headers[k.toLowerCase()] = String(v);
      }
    }
    return res;
  };

  res.end = (data?: any) => {
    if (data) body += data;
    callback({
      statusCode,
      headers,
      body,
      json: <T>() => JSON.parse(body) as T,
    });
    return res;
  };

  return res;
}

function request(
  server: ApiGatewayServer,
  method: string,
  url: string,
  headers: Record<string, string> = {}
): Promise<MockResponse> {
  return new Promise((resolve) => {
    const req = makeMockReq(method, url, headers);
    const res = makeMockRes(resolve);
    server.handleRequest(req, res);
  });
}

console.log("Running ApiGatewayServer Unit Tests...\n");

// ── Setup Common Test State ──────────────────────────────────────────────────

const registry = new AgentRegistry();
const boss = createBoss("boss-api", "Boss Agent");

// Attach internal non-public identity/sensitive properties to test allowlist stripping
const worker = createWorker("worker-api", "Worker Agent", boss.id);
(worker as any).identityFingerprint = "SECRET_FINGERPRINT";
(worker as any).riskScore = 99;

registry.register(boss);
registry.register(worker);

const stream = new LiveEventStream();
const monitoring = new ClientMonitoringService(stream);

monitoring.registerProjectTask("proj-1", "task-1");

stream.publish({
  eventType: "TASK_CREATED",
  taskId: "task-1",
  payload: { title: "API Task 1", riskScore: 0.99, identityHash: "SECRET_HASH" },
  visibility: "public",
});

const sampleTask: Task = {
  id: "task-1",
  title: "API Task 1",
  description: "Test task description",
  assignedTo: worker.id,
  createdBy: boss.id,
  status: "in_progress",
  priority: "high",
  dependencies: [],
  budget: 100,
  spent: 10,
  createdAt: "2026-09-11T10:00:00Z",
  updatedAt: "2026-09-11T10:00:00Z",
};

// Add internal sensitive key to test allowlist serialization
(sampleTask as any).internalGatewayToken = "SECRET_TOKEN";

const sampleTaskMap = new Map<string, Task>([["task-1", sampleTask]]);

const services: ApiServicesContainer = {
  registry,
  monitoringService: monitoring,
  taskProvider: {
    getTask: (id) => sampleTaskMap.get(id) ?? null,
    getTasksForProject: (projId) => (projId === "proj-1" ? [sampleTask] : []),
  },
  projectProvider: {
    getProject: (id) => (id === "proj-1" ? { id: "proj-1", status: "active", title: "Alpha Project" } : null),
  },
};

const server = new ApiGatewayServer(services);

const authHeadersA = {
  "x-client-id": "client-a",
  "x-authorized-projects": "proj-1",
};

const authHeadersB = {
  "x-client-id": "client-b",
  "x-authorized-projects": "proj-2",
};

async function runTests() {
  // ── TEST 1: GET /health works unauthenticated ────────────────────────────────
  {
    const res = await request(server, "GET", "/health");
    assert(res.statusCode === 200, "Health should return 200");
    const json = res.json<ApiResponseSuccess<{ status: string }>>();
    assert(json.success === true, "Health success should be true");
    assert(json.data.status === "ok", "Health status should be ok");
  }
  console.log("TEST 1 passed: GET /health");

  // ── TEST 2: Valid authenticated request ────────────────────────────────────
  {
    const res = await request(server, "GET", "/projects/proj-1", authHeadersA);
    assert(res.statusCode === 200, "Valid request should return 200");
    const json = res.json<ApiResponseSuccess<{ projectId: string }>>();
    assert(json.data.projectId === "proj-1", "ProjectId should match");
  }
  console.log("TEST 2 passed: Valid authenticated request");

  // ── TEST 3: Unauthenticated request rejected (401) ──────────────────────────
  {
    const res = await request(server, "GET", "/projects/proj-1");
    assert(res.statusCode === 401, "Unauthenticated request should return 401");
    const json = res.json<ApiResponseError>();
    assert(json.success === false, "Success should be false");
    assert(json.error.code === "UNAUTHENTICATED", "Error code should be UNAUTHENTICATED");
  }
  console.log("TEST 3 passed: Unauthenticated request rejected (401)");

  // ── TEST 4: Unauthorized client cannot access another project (403) ──────────
  {
    const res = await request(server, "GET", "/projects/proj-1", authHeadersB);
    assert(res.statusCode === 403, "Unauthorized client should return 403");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "FORBIDDEN", "Error code should be FORBIDDEN");
  }
  console.log("TEST 4 passed: Unauthorized client cannot access another project (403)");

  // ── TEST 5: Authorized client can access its project (200) ──────────────────
  {
    const res = await request(server, "GET", "/projects/proj-1", authHeadersA);
    assert(res.statusCode === 200, "Authorized client should return 200");
  }
  console.log("TEST 5 passed: Authorized client can access its project");

  // ── TEST 6: Project activity uses ClientMonitoringService ────────────────────
  {
    const res = await request(server, "GET", "/projects/proj-1/activity", authHeadersA);
    assert(res.statusCode === 200, "Activity should return 200");
    const json = res.json<ApiResponseSuccess<any[]>>();
    assert(json.data.length === 1, "Activity should delegate to ClientMonitoringService");
    assert(json.data[0].eventType === "TASK_CREATED", "Event type should match");
  }
  console.log("TEST 6 passed: Project activity uses ClientMonitoringService");

  // ── TEST 7: Project summary uses ClientMonitoringService ─────────────────────
  {
    const res = await request(server, "GET", "/projects/proj-1/summary", authHeadersA);
    assert(res.statusCode === 200, "Summary should return 200");
    const json = res.json<ApiResponseSuccess<any>>();
    assert(json.data.projectId === "proj-1", "Summary should match project");
    assert(json.data.tasksCreated === 1, "tasksCreated metric should be 1");
  }
  console.log("TEST 7 passed: Project summary uses ClientMonitoringService");

  // ── TEST 8: Project task listing is project-scoped ──────────────────────────
  {
    const res = await request(server, "GET", "/projects/proj-1/tasks", authHeadersA);
    assert(res.statusCode === 200, "Tasks should return 200");
    const json = res.json<ApiResponseSuccess<any[]>>();
    assert(json.data.length === 1, "Task list should contain project tasks");
    assert(json.data[0].id === "task-1", "Task ID should match");
  }
  console.log("TEST 8 passed: Project task listing is project-scoped");

  // ── TEST 9: Agent read endpoint returns safe allowlisted data ────────────────
  {
    const res = await request(server, "GET", "/agents", authHeadersA);
    assert(res.statusCode === 200, "Agents list should return 200");
    const json = res.json<ApiResponseSuccess<any[]>>();
    assert(json.data.length === 2, "Should return 2 agents");
    const workerDto = json.data.find((a) => a.id === "worker-api");
    assert(workerDto !== undefined, "Worker agent must exist");
    assert(!("identityFingerprint" in workerDto), "identityFingerprint MUST be stripped by allowlist");
    assert(!("riskScore" in workerDto), "riskScore MUST be stripped by allowlist");
    assert(workerDto.role === "worker", "Allowed field 'role' must exist");
  }
  console.log("TEST 9 passed: Agent read endpoint returns safe allowlisted data");

  // ── TEST 10: Task read endpoint returns safe allowlisted data ────────────────
  {
    const res = await request(server, "GET", "/tasks/task-1", authHeadersA);
    assert(res.statusCode === 200, "Task read should return 200");
    const json = res.json<ApiResponseSuccess<any>>();
    assert(json.data.id === "task-1", "Task ID should match");
    assert(!("internalGatewayToken" in json.data), "internalGatewayToken MUST be stripped by allowlist");
  }
  console.log("TEST 10 passed: Task read endpoint returns safe allowlisted data");

  // ── TEST 11: Malformed requests rejected (400) ────────────────────────────────
  {
    const res = await request(server, "GET", "/projects/proj-1/activity?limit=invalid", authHeadersA);
    assert(res.statusCode === 400, "Invalid limit parameter should return 400");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "BAD_REQUEST", "Error code should be BAD_REQUEST");
  }
  console.log("TEST 11 passed: Malformed requests rejected (400)");

  // ── TEST 12: Unknown resources handled consistently (404) ────────────────────
  {
    const res = await request(server, "GET", "/agents/agent-nonexistent", authHeadersA);
    assert(res.statusCode === 404, "Unknown agent should return 404");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "NOT_FOUND", "Error code should be NOT_FOUND");

    const res2 = await request(server, "GET", "/unknown/route", authHeadersA);
    assert(res2.statusCode === 404, "Unknown route should return 404");
  }
  console.log("TEST 12 passed: Unknown resources handled consistently (404)");

  // ── TEST 13: Sensitive/internal fields are not exposed ─────────────────────
  {
    const res = await request(server, "GET", "/projects/proj-1/activity", authHeadersA);
    const json = res.json<ApiResponseSuccess<any[]>>();
    const evt = json.data[0];
    assert(!("riskScore" in evt.payload), "Sensitive key 'riskScore' must not be exposed");
    assert(!("identityHash" in evt.payload), "Sensitive key 'identityHash' must not be exposed");
  }
  console.log("TEST 13 passed: Sensitive/internal fields are not exposed");

  // ── TEST 14: API does not mutate domain state ────────────────────────────────
  {
    const initialAgentCount = registry.getAll().length;
    const initialStreamCount = stream.getEventCount();

    await request(server, "GET", "/agents", authHeadersA);
    await request(server, "GET", "/projects/proj-1/summary", authHeadersA);

    assert(registry.getAll().length === initialAgentCount, "Agent registry count unchanged");
    assert(stream.getEventCount() === initialStreamCount, "Stream event count unchanged");
  }
  console.log("TEST 14 passed: API does not mutate domain state");

  // ── TEST 15: Authentication boundary is isolated from authorization ─────────
  {
    const devAuth = new HeaderDevAuthenticator();
    const mockReq = makeMockReq("GET", "/test", { "x-client-id": "client-test" });
    const authCtx = devAuth.authenticate(mockReq);

    assert(authCtx.isAuthenticated === true, "Authentication succeeds independently");
    assert(authCtx.authorizedProjectIds.length === 0, "Authorized projects empty unless specified");
  }
  console.log("TEST 15 passed: Authentication boundary is isolated from authorization");

  // ── TEST 16: Multiple clients remain isolated ────────────────────────────────
  {
    const resA = await request(server, "GET", "/projects/proj-1/summary", authHeadersA);
    const resB = await request(server, "GET", "/projects/proj-1/summary", authHeadersB);

    assert(resA.statusCode === 200, "Client A authorized for proj-1");
    assert(resB.statusCode === 403, "Client B forbidden for proj-1");
  }
  console.log("TEST 16 passed: Multiple clients remain isolated");

  console.log("\n✅ All ApiGatewayServer unit tests passed.");
}

runTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
