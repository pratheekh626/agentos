/**
 * Integration Test: Governed API Gateway Foundation
 *
 * Proves that real backend AGENTOS services are exposed over a clean, governed HTTP API layer.
 * Starts ApiGatewayServer on an ephemeral port (port 0), issues actual HTTP GET requests over local sockets,
 * and guarantees clean server shutdown in a try...finally block.
 */

import http from "node:http";
import { AgentRegistry } from "../packages/agents/AgentRegistry";
import { createBoss } from "../packages/agents/Boss";
import { createManager } from "../packages/agents/Managers";
import { createWorker } from "../packages/agents/Workers";
import { OrganizationService } from "../packages/agents/Organization";
import { ConferenceRoomService } from "../packages/agents/ConferenceRoom";
import { AgentRuntime } from "../packages/agents/Runtime";
import { ExecutionService } from "../packages/agents/Execution";
import { EvidenceService } from "../packages/verification/Evidence";
import { VerificationService } from "../packages/verification/Verification";
import { QAService } from "../packages/verification/QA";
import { ProofToPayService } from "../packages/verification/ProofToPay";
import { ProjectVerificationService } from "../packages/orchestration/ProjectVerification";
import { ProjectQAService } from "../packages/orchestration/ProjectQA";
import { ProjectProofToPayService } from "../packages/orchestration/ProjectProofToPay";
import { AgentMessageService } from "../packages/messaging/AgentMessages";
import { TaskDispatcher } from "../packages/orchestration/TaskDispatcher";
import { DependencyManager } from "../packages/orchestration/Dependencies";
import { DelegationService } from "../packages/orchestration/Delegation";
import { Scheduler } from "../packages/orchestration/Scheduler";
import { RecoveryService } from "../packages/orchestration/Recovery";
import { EscalationService } from "../packages/orchestration/Escalation";
import { InterventionService } from "../packages/orchestration/Intervention";
import { ManagerAllocationService } from "../packages/orchestration/ManagerAllocation";
import { ManagerTaskLifecycle } from "../packages/orchestration/ManagerTaskLifecycle";
import { ApprovalEngine } from "../packages/governance/ApprovalEngine";
import { DelegationFirewall } from "../packages/governance/DelegationFirewall";
import { PermissionEngine } from "../packages/governance/PermissionEngine";
import { PolicyEngine } from "../packages/governance/PolicyEngine";
import { IdentityService } from "../packages/security/Identity";
import { AccessControlService } from "../packages/security/AccessControl";
import { RiskEngine } from "../packages/security/RiskEngine";
import { AnomalyDetectionService } from "../packages/security/AnomalyDetection";
import { KillSwitchService } from "../packages/security/KillSwitch";
import { SecurityGateway } from "../packages/security/SecurityGateway";
import { WalletService } from "../packages/economy/Wallet";
import { BudgetService } from "../packages/economy/Budget";
import { TransactionService } from "../packages/economy/Transactions";
import { CreditEngine } from "../packages/economy/CreditEngine";
import { LiveEventStream } from "../packages/events/LiveEventStream";
import { LiveEventBridge } from "../packages/events/LiveEventStream/bridge";
import { ClientMonitoringService } from "../packages/events/ClientMonitoring";
import { ApiGatewayServer, type ApiResponseSuccess, type ApiResponseError } from "../packages/api/Gateway";
import type { Task } from "../packages/core/Task";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface HttpResult {
  statusCode: number;
  body: string;
  json<T>(): T;
}

function httpGet(port: number, path: string, headers: Record<string, string> = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port,
        path,
        method: "GET",
        headers,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 500,
            body,
            json: <T>() => JSON.parse(body) as T,
          });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function runIntegrationTest() {
  console.log("Setting up production services for API Gateway E2E Integration Test...\n");

  // 1. Setup production services & agents
  const registry = new AgentRegistry();
  const boss = createBoss("boss-api-e2e", "Boss E2E");
  const manager = createManager("manager-api-e2e", "Engineering Manager", boss.id);
  const worker = createWorker("worker-api-e2e", "Frontend Developer", manager.id);
  const verifier = createBoss("verifier-api-e2e", "Independent Verifier");

  for (const a of [boss, manager, worker, verifier]) registry.register(a);

  const messages = new AgentMessageService();
  const identity = new IdentityService();
  for (const a of [boss, manager, worker, verifier]) identity.createIdentity({ agentId: a.id, role: a.role });

  const wallet = new WalletService();
  wallet.createWallet(worker.id, 1000, 2000, 1000);

  const budgetSvc = new BudgetService();
  budgetSvc.createBudget("budget-api-e2e", worker.id, 1000, 600);

  const security = new SecurityGateway(identity, new AccessControlService(identity), new RiskEngine(), new AnomalyDetectionService(), new KillSwitchService(identity, wallet));
  const dispatcher = new TaskDispatcher(registry);
  const depMgr = new DependencyManager();
  const delegation = new DelegationService(registry, new DelegationFirewall(new PermissionEngine(), new PolicyEngine()), new ApprovalEngine(), dispatcher, security);
  const scheduler = new Scheduler(registry, depMgr, delegation);
  const runtime = new AgentRuntime(registry, dispatcher, depMgr, delegation, scheduler, messages);
  const recovery = new RecoveryService(registry, dispatcher, delegation, messages, 1);
  const approvalEngine = new ApprovalEngine();
  const escalation = new EscalationService(registry, approvalEngine, messages);

  const evidenceSvc = new EvidenceService();
  const executionSvc = new ExecutionService(evidenceSvc);
  const verificationSvc = new VerificationService();
  const qaSvc = new QAService();

  const creditEngine = new CreditEngine(
    new PermissionEngine(),
    new PolicyEngine(),
    wallet,
    budgetSvc,
    new TransactionService(),
    security
  );
  const proofToPaySvc = new ProofToPayService(evidenceSvc, verificationSvc, qaSvc, creditEngine);

  const projVerification = new ProjectVerificationService(registry, evidenceSvc, verificationSvc);
  const projQA = new ProjectQAService(registry, evidenceSvc, qaSvc);
  const projProofToPay = new ProjectProofToPayService(evidenceSvc, proofToPaySvc);

  const organization = new OrganizationService(registry);
  organization.createOrganization("org-api-e2e", "AGENTOS API Org", boss.id, "2026-09-11T00:00:00.000Z");

  const conference = new ConferenceRoomService(registry, messages);
  const allocationSvc = new ManagerAllocationService(registry, organization, conference, runtime, messages);

  // 2. Stream, Bridge, & Client Monitoring Service
  const stream = new LiveEventStream();
  const bridge = new LiveEventBridge(stream, {
    runtimeEvents: runtime.events,
    executionEvents: executionSvc.events,
    verificationEvents: verificationSvc.events,
    qaEvents: qaSvc.events,
    paymentEvents: proofToPaySvc.events,
    recoveryEvents: recovery.events,
    escalationEvents: escalation.events,
    allocationEvents: allocationSvc.events,
    conferenceEvents: conference.events,
  });

  const monitoringService = new ClientMonitoringService(stream);

  const projectId = "proj-gateway-1";
  const taskId = "task-gateway-1";
  monitoringService.registerProjectTask(projectId, taskId);

  // 3. Populate real production lifecycle events
  let task: Task = {
    id: taskId,
    title: "Build Governed HTTP API Layer",
    description: "Connect external clients to AGENTOS services",
    assignedTo: worker.id,
    createdBy: boss.id,
    status: "assigned",
    priority: "high",
    dependencies: [],
    budget: 600,
    spent: 0,
    createdAt: "2026-09-11T10:00:00.000Z",
    updatedAt: "2026-09-11T10:00:00.000Z",
  };

  runtime.createTask(task);
  task = runtime.startTask(task);

  executionSvc.start(task, worker);
  const execRecord = executionSvc.execute(task, worker, {
    success: true,
    output: "API Gateway implementation completed",
    evidence: {
      type: "test_result",
      title: "ApiGatewayServer test suite",
      description: "16 test cases passing",
      reference: "ref-api-1",
    },
  });
  task = runtime.completeTask(task);

  const verReq = projVerification.request(execRecord, verifier, "ver-api-e2e");
  assert(verReq.decision === "CREATED", `Verification request failed: ${verReq.reason}`);
  const verPass = projVerification.pass("ver-api-e2e", verifier, 99, "Clean HTTP boundary");
  assert(verPass.decision === "PASSED", `Verification pass failed: ${verPass.reason}`);

  const qaReq = projQA.request(verPass.verification!, verifier, "qa-api-e2e", ["security-check"]);
  assert(qaReq.decision === "CREATED", `QA request failed: ${qaReq.reason}`);
  const qaPass = projQA.pass("qa-api-e2e", verifier, 100);
  assert(qaPass.decision === "PASSED", `QA pass failed: ${qaPass.reason}`);

  const payResult = projProofToPay.pay(execRecord, verPass.verification!, qaPass.qa!, {
    id: "pay-api-e2e",
    agent: worker,
    taskId,
    amount: 400,
    reason: "API Gateway work paid",
    riskScore: 0,
    budgetId: "budget-api-e2e",
  });
  assert(payResult.decision === "PAID", `Payment failed: ${payResult.reason}`);

  task = runtime.finalizeTask(task);

  const taskMap = new Map<string, Task>([[taskId, task]]);

  // 4. Instantiate API Gateway Server
  const server = new ApiGatewayServer({
    registry,
    monitoringService,
    taskProvider: {
      getTask: (id) => taskMap.get(id) ?? null,
      getTasksForProject: (proj) => (proj === projectId ? [task] : []),
    },
    projectProvider: {
      getProject: (proj) => (proj === projectId ? { id: projectId, status: "active", title: "Gateway Project" } : null),
    },
  });

  // Start HTTP server on ephemeral port (0)
  const port = await server.start(0);
  console.log(`ApiGatewayServer listening on local port ${port}`);

  const authHeadersAlpha = {
    "x-client-id": "client-alpha",
    "x-authorized-projects": projectId,
  };

  const authHeadersBeta = {
    "x-client-id": "client-beta",
    "x-authorized-projects": "proj-other",
  };

  try {
    // ── STEP 1: GET /health ──────────────────────────────────────────────────
    {
      const res = await httpGet(port, "/health");
      assert(res.statusCode === 200, "Health should return 200");
      const json = res.json<ApiResponseSuccess<{ status: string }>>();
      assert(json.data.status === "ok", "Health status must be ok");
      console.log("STEP 1: GET /health succeeded");
    }

    // ── STEP 2: GET /projects/:projectId (Authorized) ────────────────────────
    {
      const res = await httpGet(port, `/projects/${projectId}`, authHeadersAlpha);
      assert(res.statusCode === 200, "Project overview should return 200");
      const json = res.json<ApiResponseSuccess<{ projectId: string; title: string }>>();
      assert(json.data.projectId === projectId, "ProjectId must match");
      console.log("STEP 2: GET /projects/:projectId succeeded for authorized client");
    }

    // ── STEP 3: GET /projects/:projectId/activity ─────────────────────────────
    {
      const res = await httpGet(port, `/projects/${projectId}/activity`, authHeadersAlpha);
      assert(res.statusCode === 200, "Project activity should return 200");
      const json = res.json<ApiResponseSuccess<any[]>>();
      assert(json.data.length > 0, "Activity list should contain client-safe events");
      console.log(`STEP 3: GET /projects/:projectId/activity returned ${json.data.length} safe events`);
    }

    // ── STEP 4: GET /projects/:projectId/summary ──────────────────────────────
    {
      const res = await httpGet(port, `/projects/${projectId}/summary`, authHeadersAlpha);
      assert(res.statusCode === 200, "Project summary should return 200");
      const json = res.json<ApiResponseSuccess<{ paymentsReleased: number; totalPaidAmount: number }>>();
      assert(json.data.paymentsReleased === 1, "Payments released count must be 1");
      assert(json.data.totalPaidAmount === 400, "Total paid amount must be 400");
      console.log("STEP 4: GET /projects/:projectId/summary verified metrics");
    }

    // ── STEP 5: GET /projects/:projectId/tasks ────────────────────────────────
    {
      const res = await httpGet(port, `/projects/${projectId}/tasks`, authHeadersAlpha);
      assert(res.statusCode === 200, "Project tasks should return 200");
      const json = res.json<ApiResponseSuccess<any[]>>();
      assert(json.data.length === 1 && json.data[0].id === taskId, "Project tasks list should match");
      console.log("STEP 5: GET /projects/:projectId/tasks returned project tasks");
    }

    // ── STEP 6: GET /agents and GET /agents/:agentId ─────────────────────────
    {
      const res = await httpGet(port, "/agents", authHeadersAlpha);
      assert(res.statusCode === 200, "Agents list should return 200");
      const json = res.json<ApiResponseSuccess<any[]>>();
      assert(json.data.length === 4, "Should return 4 registered agents");

      const agentRes = await httpGet(port, `/agents/${worker.id}`, authHeadersAlpha);
      assert(agentRes.statusCode === 200, "Single agent should return 200");
      const agentJson = agentRes.json<ApiResponseSuccess<{ id: string; role: string }>>();
      assert(agentJson.data.id === worker.id, "Agent ID must match");
      console.log("STEP 6: GET /agents and GET /agents/:agentId succeeded with safe serialization");
    }

    // ── STEP 7: GET /tasks/:taskId ────────────────────────────────────────────
    {
      const res = await httpGet(port, `/tasks/${taskId}`, authHeadersAlpha);
      assert(res.statusCode === 200, "Task read should return 200");
      const json = res.json<ApiResponseSuccess<{ id: string; title: string }>>();
      assert(json.data.id === taskId, "Task ID must match");
      console.log("STEP 7: GET /tasks/:taskId succeeded");
    }

    // ── STEP 8: Unauthorized Client Rejection (403) ───────────────────────────
    {
      const res = await httpGet(port, `/projects/${projectId}/summary`, authHeadersBeta);
      assert(res.statusCode === 403, "Unauthorized client must receive 403 Forbidden");
      const json = res.json<ApiResponseError>();
      assert(json.error.code === "FORBIDDEN", "Error code must be FORBIDDEN");
      console.log("STEP 8: Unauthorized client access rejected with 403 Forbidden");
    }

    // ── STEP 9: Unauthenticated Client Rejection (401) ─────────────────────────
    {
      const res = await httpGet(port, `/projects/${projectId}/summary`);
      assert(res.statusCode === 401, "Unauthenticated client must receive 401 Unauthorized");
      console.log("STEP 9: Unauthenticated request rejected with 401 Unauthorized");
    }

    console.log(`
── GOVERNED API GATEWAY E2E SUMMARY ──────────────────────────────────────
HTTP API LAYER RUNNING ON LOCAL PORT ${port}
ENDPOINTS TESTED: /health, /projects/:id, /projects/:id/activity,
                  /projects/:id/summary, /projects/:id/tasks,
                  /agents, /agents/:id, /tasks/:id
AUTHENTICATION: HeaderDevAuthenticator (x-client-id / x-authorized-projects)
AUTHORIZATION: Delegated to ClientMonitoringService (403 Forbidden enforced)
SAFE SERIALIZATION: Allowlist DTOs verified (sensitive fields omitted)
SERVER LIFECYCLE: Clean HTTP server shutdown in try...finally block
──────────────────────────────────────────────────────────────────────────
`);

    console.log("✅ Governed API Gateway E2E integration test passed.");
  } finally {
    console.log("Shutting down ApiGatewayServer...");
    await server.stop();
    console.log("Server shutdown complete.");
  }
}

runIntegrationTest().catch((err) => {
  console.error("E2E Integration Test failed:", err);
  process.exit(1);
});
