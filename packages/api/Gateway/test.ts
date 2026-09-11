import { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { AgentRegistry } from "../../agents/AgentRegistry";
import { createBoss } from "../../agents/Boss";
import { createManager } from "../../agents/Managers";
import { createWorker } from "../../agents/Workers";
import { LiveEventStream } from "../../events/LiveEventStream";
import { ClientMonitoringService } from "../../events/ClientMonitoring";
import { RequirementUnderstandingService } from "../../agents/RequirementUnderstanding";
import { ProjectIntakeService } from "../../agents/ProjectIntake";
import { BossPlanningService } from "../../agents/BossPlanning";
import { TaskDispatcher } from "../../orchestration/TaskDispatcher";
import { PlanExecutionService } from "../../orchestration/PlanExecution";
import { OrganizationService } from "../../agents/Organization";
import { ConferenceRoomService } from "../../agents/ConferenceRoom";
import { ManagerAllocationService } from "../../orchestration/ManagerAllocation";
import { AgentMessageService } from "../../messaging/AgentMessages";
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
  headers: Record<string, string> = {},
  bodyData?: string | object
): Promise<MockResponse> {
  return new Promise((resolve) => {
    const req = makeMockReq(method, url, headers);
    const res = makeMockRes(resolve);

    const handlePromise = server.handleRequest(req, res);

    if (bodyData !== undefined) {
      const payload = typeof bodyData === "string" ? bodyData : JSON.stringify(bodyData);
      process.nextTick(() => {
        req.emit("data", Buffer.from(payload));
        req.emit("end");
      });
    } else {
      process.nextTick(() => {
        req.emit("end");
      });
    }
  });
}

console.log("Running ApiGatewayServer Unit Tests...\n");

// ── Setup Common Test State ──────────────────────────────────────────────────

const registry = new AgentRegistry();
const boss = createBoss("boss-api", "Boss Agent");
const manager = createManager("manager-api", "Engineering Manager", boss.id);
const worker = createWorker("worker-api", "Worker Agent", manager.id);
(worker as any).identityFingerprint = "SECRET_FINGERPRINT";
(worker as any).riskScore = 99;

const otherBoss = createBoss("boss-other-api", "Other Boss");
const otherManager = createManager("manager-other-api", "Other Manager", otherBoss.id);

for (const a of [boss, manager, worker, otherBoss, otherManager]) {
  registry.register(a);
}

const organizationService = new OrganizationService(registry);
organizationService.createOrganization("org-api-1", "API Test Org", boss.id);
organizationService.addManager(manager.id, "backend");

const messages = new AgentMessageService();
const conferenceRoomService = new ConferenceRoomService(registry, messages);

const stream = new LiveEventStream();
const monitoring = new ClientMonitoringService(stream);
const requirementService = new RequirementUnderstandingService();
const projectIntakeService = new ProjectIntakeService(registry);
const planningService = new BossPlanningService(registry);
const taskDispatcher = new TaskDispatcher(registry);
const planExecutionService = new PlanExecutionService(registry, taskDispatcher);
const managerAllocationService = new ManagerAllocationService(
  registry,
  organizationService,
  conferenceRoomService,
  null as any,
  messages
);

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

(sampleTask as any).internalGatewayToken = "SECRET_TOKEN";

const sampleTaskMap = new Map<string, Task>([["task-1", sampleTask]]);

const services: ApiServicesContainer = {
  registry,
  monitoringService: monitoring,
  requirementService,
  projectIntakeService,
  planningService,
  planExecutionService,
  managerAllocationService,
  organizationService,
  conferenceRoomService,
  bossAgentId: boss.id,
  taskProvider: {
    getTask: (id) => sampleTaskMap.get(id) ?? null,
    getTasksForProject: (projId) => (projId === "proj-1" ? [sampleTask] : []),
  },
  projectProvider: {
    getProject: (id) => {
      if (id === "proj-1") return { id: "proj-1", status: "active", title: "Alpha Project" };
      const proj = projectIntakeService.get(id);
      return proj ? { id: proj.id, status: proj.status, title: proj.objective } : null;
    },
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
    assert(json.data.length === 5, "Should return 5 agents");
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

  // ── TEST 14: API does not mutate domain state on GET requests ─────────────────
  {
    const initialAgentCount = registry.getAll().length;
    const initialStreamCount = stream.getEventCount();

    await request(server, "GET", "/agents", authHeadersA);
    await request(server, "GET", "/projects/proj-1/summary", authHeadersA);

    assert(registry.getAll().length === initialAgentCount, "Agent registry count unchanged");
    assert(stream.getEventCount() === initialStreamCount, "Stream event count unchanged");
  }
  console.log("TEST 14 passed: API does not mutate domain state on GET requests");

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

  // ── TEST 17: POST /projects unauthenticated is rejected (401) ─────────────────
  {
    const res = await request(server, "POST", "/projects", {}, { input: "Build app" });
    assert(res.statusCode === 401, "Unauthenticated POST /projects should return 401");
  }
  console.log("TEST 17 passed: POST /projects unauthenticated rejected (401)");

  // ── TEST 18: POST /projects empty / malformed request rejected (400) ─────────
  {
    const res1 = await request(server, "POST", "/projects", authHeadersA, {});
    assert(res1.statusCode === 400, "Empty POST /projects payload should return 400");

    const res2 = await request(server, "POST", "/projects", authHeadersA, "not json");
    assert(res2.statusCode === 400, "Malformed JSON POST /projects payload should return 400");
  }
  console.log("TEST 18 passed: POST /projects empty / malformed request rejected (400)");

  // ── TEST 19: POST /projects valid input -> 201 Created & safe DTO ────────────
  {
    const postPayload = {
      projectId: "proj-post-alpha",
      input: "Objective: Build dashboard\nRequirements:\n- Add SSE feed\nConstraints:\n- Node native\nDeliverables:\n- Source code\nAcceptance Criteria:\n- Test passes",
      clientId: "spoofed-client-id", // Attempt to spoof clientId in body
    };

    const res = await request(server, "POST", "/projects", authHeadersA, postPayload);
    assert(res.statusCode === 201, `Valid POST /projects should return 201 Created (got ${res.statusCode}: ${res.body})`);
    const json = res.json<ApiResponseSuccess<any>>();
    assert(json.success === true, "Response success must be true");
    assert(json.data.projectId === "proj-post-alpha", "ProjectId must match");
    assert(json.data.clientId === "client-a", "ClientId MUST be authoritative 'client-a', NOT spoofed");
    assert(json.data.status === "planned", "Status must be 'planned'");
    assert(!("internalReason" in json.data), "Internal details must not be in safe project DTO");

    // Verify project is now authorized for client-a and accessible via GET
    const getRes = await request(server, "GET", "/projects/proj-post-alpha", authHeadersA);
    assert(getRes.statusCode === 200, "Created project must be accessible via GET for client-a");

    // Verify client-b CANNOT access client-a's newly created project
    const crossGet = await request(server, "GET", "/projects/proj-post-alpha", authHeadersB);
    assert(crossGet.statusCode === 403, "Client B must receive 403 Forbidden attempting to access Client A's project");
  }
  console.log("TEST 19 passed: POST /projects valid input -> 201 Created & cross-client isolated");

  // ── TEST 20: POST /projects needs clarification -> 200 OK ────────────────────
  {
    const vaguePayload = {
      projectId: "proj-vague-1",
      input: "Fix stuff",
    };

    const res = await request(server, "POST", "/projects", authHeadersA, vaguePayload);
    assert(res.statusCode === 200, "Needs clarification should return 200 OK");
    const json = res.json<ApiResponseSuccess<any>>();
    assert(json.data.status === "needs_clarification", "Status must be needs_clarification");
    assert(Array.isArray(json.data.clarificationQuestions), "Must include clarification questions");
    assert(json.data.clarificationQuestions.length > 0, "Questions array must not be empty");
  }
  console.log("TEST 20 passed: POST /projects needs clarification -> 200 OK");

  // ── TEST 21: POST /projects duplicate projectId -> 409 Conflict ──────────────
  {
    const dupePayload = {
      projectId: "proj-post-alpha", // Already created in TEST 19
      input: "Objective: Duplicate test\nRequirements:\n- Duplicate\nConstraints:\n- None\nDeliverables:\n- None\nAcceptance Criteria:\n- None",
    };

    const res = await request(server, "POST", "/projects", authHeadersA, dupePayload);
    assert(res.statusCode === 409, "Duplicate project ID should return 409 Conflict");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "PROJECT_EXISTS", "Error code should be PROJECT_EXISTS");
  }
  console.log("TEST 21 passed: POST /projects duplicate projectId -> 409 Conflict");

  // ── TEST 22: POST /projects/:projectId/plan unauthenticated -> 401 ───────────
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/plan", {}, { planId: "plan-unauth" });
    assert(res.statusCode === 401, "Unauthenticated planning request should return 401");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "UNAUTHENTICATED", "Error code should be UNAUTHENTICATED");
  }
  console.log("TEST 22 passed: POST /projects/:projectId/plan unauthenticated -> 401");

  // ── TEST 23: POST /projects/:projectId/plan unauthorized client -> 403 ───────
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/plan", authHeadersB, { planId: "plan-cross" });
    assert(res.statusCode === 403, "Unauthorized client planning request should return 403");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "FORBIDDEN", "Error code should be FORBIDDEN");
  }
  console.log("TEST 23 passed: POST /projects/:projectId/plan unauthorized client -> 403");

  // ── TEST 24: POST /projects/:projectId/plan non-existent project -> 404 ──────
  {
    const authHeadersMissing = {
      "x-client-id": "client-a",
      "x-authorized-projects": "nonexistent-proj",
    };
    const res = await request(server, "POST", "/projects/nonexistent-proj/plan", authHeadersMissing, { planId: "plan-404" });
    assert(res.statusCode === 404, "Non-existent project planning request should return 404");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "NOT_FOUND", "Error code should be NOT_FOUND");
  }
  console.log("TEST 24 passed: POST /projects/:projectId/plan non-existent project -> 404");

  // ── TEST 25: POST /projects/:projectId/plan valid request -> 201 Created ─────
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/plan", authHeadersA, { planId: "plan-alpha-1" });
    assert(res.statusCode === 201, `Valid planning request should return 201 Created (got ${res.statusCode}: ${res.body})`);
    const json = res.json<ApiResponseSuccess<any>>();
    assert(json.success === true, "Response success must be true");
    assert(json.data.planId === "plan-alpha-1", "Plan ID must match");
    assert(json.data.projectId === "proj-post-alpha", "ProjectId must match target project");
    assert(json.data.plannedBy === boss.id, "PlannedBy must be authoritative Boss agent ID");
    assert(Array.isArray(json.data.tasks), "Tasks must be an array of blueprint PlannedTask objects");
    assert(json.data.tasks.length > 0, "Plan tasks array must not be empty");
  }
  console.log("TEST 25 passed: POST /projects/:projectId/plan valid request -> 201 Created & safe DTO");

  // ── TEST 26: POST /projects/:projectId/plan duplicate plan ID -> 409 Conflict ──
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/plan", authHeadersA, { planId: "plan-alpha-1" });
    assert(res.statusCode === 409, "Duplicate plan ID should return 409 Conflict");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "PLAN_EXISTS", "Error code should be PLAN_EXISTS");
  }
  console.log("TEST 26 passed: POST /projects/:projectId/plan duplicate plan ID -> 409 Conflict");

  // ── TEST 27: POST /projects/:projectId/execute-plan unauthenticated -> 401 ────
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/execute-plan", {});
    assert(res.statusCode === 401, "Unauthenticated execute-plan request should return 401");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "UNAUTHENTICATED", "Error code should be UNAUTHENTICATED");
  }
  console.log("TEST 27 passed: POST /projects/:projectId/execute-plan unauthenticated -> 401");

  // ── TEST 28: POST /projects/:projectId/execute-plan unauthorized client -> 403 ──
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/execute-plan", authHeadersB);
    assert(res.statusCode === 403, "Unauthorized client execute-plan request should return 403");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "FORBIDDEN", "Error code should be FORBIDDEN");
  }
  console.log("TEST 28 passed: POST /projects/:projectId/execute-plan unauthorized client -> 403");

  // ── TEST 29: POST /projects/:projectId/execute-plan unknown project -> 404 ───
  {
    const authHeadersMissing = {
      "x-client-id": "client-a",
      "x-authorized-projects": "nonexistent-proj",
    };
    const res = await request(server, "POST", "/projects/nonexistent-proj/execute-plan", authHeadersMissing);
    assert(res.statusCode === 404, "Non-existent project execute-plan request should return 404");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "NOT_FOUND", "Error code should be NOT_FOUND");
  }
  console.log("TEST 29 passed: POST /projects/:projectId/execute-plan unknown project -> 404");

  // ── TEST 30: POST /projects/:projectId/execute-plan project without plan -> 404 ──
  {
    // Create a project with no execution plan
    const postPayload = {
      projectId: "proj-no-plan",
      input: "Objective: No plan project\nRequirements:\n- Test requirement\nConstraints:\n- None\nDeliverables:\n- None\nAcceptance Criteria:\n- None",
    };
    await request(server, "POST", "/projects", authHeadersA, postPayload);

    const res = await request(server, "POST", "/projects/proj-no-plan/execute-plan", authHeadersA);
    assert(res.statusCode === 404, "Project without execution plan should return 404");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "NOT_FOUND", "Error code should be NOT_FOUND");
  }
  console.log("TEST 30 passed: POST /projects/:projectId/execute-plan project without plan -> 404");

  // ── TEST 31: POST /projects/:projectId/execute-plan valid authorized execution -> 201 ──
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/execute-plan", authHeadersA);
    assert(res.statusCode === 201, `Valid execute-plan request should return 201 Created (got ${res.statusCode}: ${res.body})`);
    const json = res.json<ApiResponseSuccess<any>>();
    assert(json.success === true, "Response success must be true");
    assert(json.data.projectId === "proj-post-alpha", "ProjectId must match target project");
    assert(json.data.planId === "plan-alpha-1", "PlanId must match created plan");
    assert(Array.isArray(json.data.tasks), "Tasks must be an array");
    assert(json.data.tasks.length > 0, "Materialized tasks array must not be empty");

    for (const t of json.data.tasks) {
      assert(t.status === "queued", `Task status must be 'queued' (got ${t.status})`);
      assert(t.assignedTo === null, `Task assignedTo must be null (got ${t.assignedTo})`);
      assert(t.spent === 0, `Task spent credits must be 0 (got ${t.spent})`);
      assert(t.createdBy === boss.id, "Task createdBy must be authoritative Boss ID");
      assert(!("internalGatewayToken" in t), "Internal gateway tokens must be stripped");
    }
  }
  console.log("TEST 31 passed: POST /projects/:projectId/execute-plan valid authorized execution -> 201 Created & safe DTOs (queued & unassigned)");

  // ── TEST 32: Arbitrary task injection & bossId override strictly ignored ──
  {
    // Create a new project & plan for override test
    await request(server, "POST", "/projects", authHeadersA, {
      projectId: "proj-tamper",
      input: "Objective: Tamper test\nRequirements:\n- Req 1\nConstraints:\n- None\nDeliverables:\n- Deliv 1\nAcceptance Criteria:\n- None",
    });
    await request(server, "POST", "/projects/proj-tamper/plan", authHeadersA, { planId: "plan-tamper" });

    // Attempt to inject arbitrary fake tasks and fake bossId in execute-plan payload
    const tamperPayload = {
      bossId: "fake-boss-id-override",
      tasks: [{ id: "fake-injected-task", title: "Malicious Task", status: "completed" }],
    };

    const res = await request(server, "POST", "/projects/proj-tamper/execute-plan", authHeadersA, tamperPayload);
    assert(res.statusCode === 201, "Execute-plan with extra payload should ignore injected tasks/bossId and return 201");
    const json = res.json<ApiResponseSuccess<any>>();
    assert(json.data.tasks.every((t: any) => t.status === "queued" && t.assignedTo === null), "All tasks must remain queued & unassigned");
    assert(json.data.tasks.every((t: any) => t.createdBy === boss.id), "createdBy must remain authoritative Boss ID, NOT spoofed");
    assert(!json.data.tasks.some((t: any) => t.id === "fake-injected-task"), "Injected arbitrary task must NOT exist");
  }
  console.log("TEST 32 passed: Arbitrary task injection & bossId override strictly ignored");

  // ── TEST 33: Duplicate plan execution returns 409 Conflict ───────────────
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/execute-plan", authHeadersA);
    assert(res.statusCode === 409, "Duplicate plan execution should return 409 Conflict");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "PLAN_ALREADY_EXECUTED", "Error code should be PLAN_ALREADY_EXECUTED");
  }
  console.log("TEST 33 passed: Duplicate plan execution returns 409 Conflict");

  // ── Setup meeting & decision for allocation tests ──────────────────────────
  const allocMeeting = conferenceRoomService.createMeeting({
    id: "meeting-alpha-1",
    projectId: "proj-post-alpha",
    calledBy: boss.id,
    participants: [manager.id],
    agenda: "Allocate manager for proj-post-alpha",
  });
  conferenceRoomService.startMeeting(allocMeeting.id);
  const allocDecision = conferenceRoomService.createDecision({
    id: "decision-alpha-1",
    meetingId: allocMeeting.id,
    decidedBy: boss.id,
    decisionType: "ASSIGN_MANAGER",
    summary: "Assign manager-api to proj-post-alpha tasks",
    taskIds: ["plan-alpha-1-requirement-1"],
    managerId: manager.id,
  });

  const validAllocPayload = {
    allocationId: "alloc-alpha-1",
    meetingId: allocMeeting.id,
    decisionId: allocDecision.id,
    managerId: manager.id,
    taskIds: ["plan-alpha-1-requirement-1"],
  };

  // ── TEST 34: POST /projects/:projectId/allocate-manager unauthenticated -> 401 ──
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/allocate-manager", {}, validAllocPayload);
    assert(res.statusCode === 401, "Unauthenticated allocate-manager should return 401");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "UNAUTHENTICATED", "Error code should be UNAUTHENTICATED");
  }
  console.log("TEST 34 passed: POST /projects/:projectId/allocate-manager unauthenticated -> 401");

  // ── TEST 35: Client B attempting to allocate manager for Client A project -> 403 ──
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/allocate-manager", authHeadersB, validAllocPayload);
    assert(res.statusCode === 403, "Unauthorized client allocate-manager should return 403");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "FORBIDDEN", "Error code should be FORBIDDEN");
  }
  console.log("TEST 35 passed: Client B attempting to allocate manager for Client A project -> 403");

  // ── TEST 36: Unknown project -> 404 ─────────────────────────────────────────
  {
    const authHeadersMissing = {
      "x-client-id": "client-a",
      "x-authorized-projects": "nonexistent-proj",
    };
    const res = await request(server, "POST", "/projects/nonexistent-proj/allocate-manager", authHeadersMissing, validAllocPayload);
    assert(res.statusCode === 404, "Unknown project allocate-manager should return 404");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "NOT_FOUND", "Error code should be NOT_FOUND");
  }
  console.log("TEST 36 passed: Unknown project -> 404");

  // ── TEST 37: Project without execution plan -> 404 ──────────────────────────
  {
    const res = await request(server, "POST", "/projects/proj-no-plan/allocate-manager", authHeadersA, validAllocPayload);
    assert(res.statusCode === 404, "Project without execution plan should return 404");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "NOT_FOUND", "Error code should be NOT_FOUND");
  }
  console.log("TEST 37 passed: Project without execution plan -> 404");

  // ── TEST 38: Malformed/empty request -> 400 ─────────────────────────────────
  {
    const res1 = await request(server, "POST", "/projects/proj-post-alpha/allocate-manager", authHeadersA, {});
    assert(res1.statusCode === 400, "Empty payload allocate-manager should return 400");

    const res2 = await request(server, "POST", "/projects/proj-post-alpha/allocate-manager", authHeadersA, { managerId: manager.id, taskIds: [] });
    assert(res2.statusCode === 400, "Empty taskIds array allocate-manager should return 400");
  }
  console.log("TEST 38 passed: Malformed/empty request -> 400");

  // ── TEST 39: Unknown manager -> 400 ─────────────────────────────────────────
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/allocate-manager", authHeadersA, {
      ...validAllocPayload,
      managerId: "nonexistent-manager-id",
    });
    assert(res.statusCode === 400, "Unknown manager allocate-manager should return 400");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "BAD_REQUEST", "Error code should be BAD_REQUEST");
  }
  console.log("TEST 39 passed: Unknown manager -> 400");

  // ── TEST 40: Worker supplied as manager -> 400 ──────────────────────────────
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/allocate-manager", authHeadersA, {
      ...validAllocPayload,
      managerId: worker.id,
    });
    assert(res.statusCode === 400, "Worker supplied as manager should return 400");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "BAD_REQUEST", "Error code should be BAD_REQUEST");
  }
  console.log("TEST 40 passed: Worker supplied as manager -> 400");

  // ── TEST 41: Boss supplied as manager -> 400 ────────────────────────────────
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/allocate-manager", authHeadersA, {
      ...validAllocPayload,
      managerId: boss.id,
    });
    assert(res.statusCode === 400, "Boss supplied as manager should return 400");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "BAD_REQUEST", "Error code should be BAD_REQUEST");
  }
  console.log("TEST 41 passed: Boss supplied as manager -> 400");

  // ── TEST 42: Manager from wrong hierarchy -> 400 ───────────────────────────
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/allocate-manager", authHeadersA, {
      ...validAllocPayload,
      managerId: otherManager.id,
    });
    assert(res.statusCode === 400, "Manager from wrong hierarchy should return 400");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "BAD_REQUEST", "Error code should be BAD_REQUEST");
  }
  console.log("TEST 42 passed: Manager from wrong hierarchy -> 400");

  // ── TEST 43: Unknown task ID -> 400 ─────────────────────────────────────────
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/allocate-manager", authHeadersA, {
      ...validAllocPayload,
      taskIds: ["nonexistent-task-id"],
    });
    assert(res.statusCode === 400, "Unknown task ID should return 400");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "BAD_REQUEST", "Error code should be BAD_REQUEST");
  }
  console.log("TEST 43 passed: Unknown task ID -> 400");

  // ── TEST 44: Task from another project -> 400 ───────────────────────────────
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/allocate-manager", authHeadersA, {
      ...validAllocPayload,
      taskIds: ["task-1"], // belongs to proj-1, not proj-post-alpha
    });
    assert(res.statusCode === 400, "Task from another project should return 400");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "BAD_REQUEST", "Error code should be BAD_REQUEST");
  }
  console.log("TEST 44 passed: Task from another project -> 400");

  // ── TEST 45-52: Valid manager allocation & lifecycle boundary assertions ───
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/allocate-manager", authHeadersA, validAllocPayload);
    assert(res.statusCode === 201, `Valid allocate-manager should return 201 Created (got ${res.statusCode}: ${res.body})`);
    const json = res.json<ApiResponseSuccess<any>>();
    assert(json.success === true, "Response success must be true");

    const alloc = json.data;
    assert(alloc.allocationId === "alloc-alpha-1", "Allocation ID must match");
    assert(alloc.projectId === "proj-post-alpha", "ProjectId must match target project");
    assert(alloc.managerId === manager.id, "ManagerId must match");
    assert(alloc.status === "PROPOSED", "Allocation status MUST be 'PROPOSED'"); // TEST 46, 48, 49
    assert(alloc.assignedBy === boss.id, "AssignedBy must be authoritative Boss ID");
    assert(!("internalToken" in alloc), "Internal fields must be stripped"); // TEST 47

    // Assert worker & task state remain strictly unchanged (TEST 50, 51, 52)
    assert(worker.status === "idle", "Worker agent must remain idle");
    const getTaskRes = await request(server, "GET", "/tasks/plan-alpha-1-requirement-1", authHeadersA);
    if (getTaskRes.statusCode === 200) {
      const taskJson = getTaskRes.json<ApiResponseSuccess<any>>();
      assert(taskJson.data.assignedTo === null, "Task must remain unassigned");
      assert(taskJson.data.status === "queued", "Task must remain queued");
    }
  }
  console.log("TEST 45-52 passed: Valid manager allocation -> 201 Created & status remains PROPOSED (unassigned & unexecuted)");

  // ── TEST 53 & 54: Body spoofing (clientId / assignedBy) strictly ignored ─────
  {
    const spoofPayload = {
      allocationId: "alloc-spoof-1",
      meetingId: allocMeeting.id,
      decisionId: allocDecision.id,
      managerId: manager.id,
      taskIds: ["plan-alpha-1-requirement-1"],
      clientId: "spoofed-client-id",
      assignedBy: "fake-boss-id-override",
    };
    const res = await request(server, "POST", "/projects/proj-post-alpha/allocate-manager", authHeadersA, spoofPayload);
    assert(res.statusCode === 201, "Spoofed allocation request should succeed with authoritative values");
    const json = res.json<ApiResponseSuccess<any>>();
    assert(json.data.assignedBy === boss.id, "assignedBy MUST remain authoritative Boss ID, NOT spoofed");
  }
  console.log("TEST 53-54 passed: Body spoofing (clientId / assignedBy) strictly ignored");

  // ── TEST 55: Duplicate allocation -> 409 Conflict ───────────────────────────
  {
    const res = await request(server, "POST", "/projects/proj-post-alpha/allocate-manager", authHeadersA, validAllocPayload);
    assert(res.statusCode === 409, "Duplicate allocation ID should return 409 Conflict");
    const json = res.json<ApiResponseError>();
    assert(json.error.code === "ALLOCATION_EXISTS", "Error code should be ALLOCATION_EXISTS");
  }
  console.log("TEST 55 passed: Duplicate allocation -> 409 Conflict");

  console.log("\n✅ All ApiGatewayServer unit tests passed.");
}

runTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
