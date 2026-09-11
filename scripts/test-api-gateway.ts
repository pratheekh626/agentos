/**
 * Integration Test: Governed API Gateway Foundation & Client Project Intake Command
 *
 * Proves that real backend AGENTOS services are exposed over a clean, governed HTTP API layer.
 * Tests both GET read endpoints and POST /projects command pipeline:
 *   HTTP POST /projects
 *   → Authenticated client
 *   → RequirementUnderstandingService
 *   → ProjectIntakeService (Boss Intake)
 *   → EventBus / LiveEventStream
 *   → ClientMonitoringService
 *   → Safe HTTP Response (201 Created)
 *
 * Starts ApiGatewayServer on an ephemeral port (port 0), issues actual HTTP requests over local sockets,
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
import { ManagerAllocationService } from "../packages/orchestration/ManagerAllocation";
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
import { RequirementUnderstandingService } from "../packages/agents/RequirementUnderstanding";
import { ProjectIntakeService, type Project } from "../packages/agents/ProjectIntake";
import { BossPlanningService } from "../packages/agents/BossPlanning";
import { PlanExecutionService } from "../packages/orchestration/PlanExecution";
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

function httpPost(port: number, path: string, headers: Record<string, string> = {}, bodyData?: object | string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = typeof bodyData === "string" ? bodyData : JSON.stringify(bodyData ?? {});
    const req = http.request(
      {
        hostname: "localhost",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers,
        },
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
    req.write(payload);
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

  const requirementService = new RequirementUnderstandingService();
  const projectIntakeService = new ProjectIntakeService(registry);
  const planningService = new BossPlanningService(registry);
  const planExecutionService = new PlanExecutionService(registry, dispatcher);

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
  const projectStore = new Map<string, Project>();

  // 4. Instantiate API Gateway Server
  const server = new ApiGatewayServer({
    registry,
    monitoringService,
    requirementService,
    projectIntakeService,
    planningService,
    planExecutionService,
    managerAllocationService: allocationSvc,
    organizationService: organization,
    conferenceRoomService: conference,
    bossAgentId: boss.id,
    taskProvider: {
      getTask: (id: string) => taskMap.get(id) ?? null,
      getTasksForProject: (proj: string) => (proj === projectId ? [task] : []),
    },
    projectProvider: {
      getProject: (proj: string) => {
        if (proj === projectId) return { id: projectId, status: "active", title: "Gateway Project" };
        const stored = projectStore.get(proj);
        return stored ? { id: stored.id, status: stored.status, title: stored.objective } : null;
      },
      registerProject: (proj: Project) => {
        projectStore.set(proj.id, proj);
      },
    } as any,
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

    // ── STEP 2: POST /projects (Governed Client Intake via HTTP) ─────────────
    const newProjectId = "proj-client-post-1";
    {
      const postPayload = {
        projectId: newProjectId,
        input: "Objective: Build Client Portal API\nRequirements:\n- Add POST /projects command\nConstraints:\n- Node native\nDeliverables:\n- Source code\nAcceptance Criteria:\n- Tests pass",
        clientId: "spoofed-client-id", // Attempt body spoofing
      };

      const res = await httpPost(port, "/projects", authHeadersAlpha, postPayload);
      assert(res.statusCode === 201, `POST /projects should return 201 Created (got ${res.statusCode}: ${res.body})`);
      const json = res.json<ApiResponseSuccess<any>>();
      assert(json.success === true, "Response success must be true");
      assert(json.data.projectId === newProjectId, "ProjectId must match");
      assert(json.data.clientId === "client-alpha", "ClientId MUST be authoritative 'client-alpha'");
      assert(json.data.status === "planned", "Status must be 'planned'");
      console.log("STEP 2: POST /projects succeeded: 201 Created for client-alpha");
    }

    // ── STEP 3: Verify Client Alpha can GET new project & Client Beta gets 403 ─
    {
      const getRes = await httpGet(port, `/projects/${newProjectId}`, authHeadersAlpha);
      assert(getRes.statusCode === 200, "Client Alpha must be authorized to GET its newly created project");

      const betaGet = await httpGet(port, `/projects/${newProjectId}`, authHeadersBeta);
      assert(betaGet.statusCode === 403, "Client Beta must receive 403 Forbidden attempting to access Client Alpha's project");
      console.log("STEP 3: Cross-client project access security verified (Client Alpha: 200, Client Beta: 403)");
    }

    // ── STEP 4: POST /projects Needs Clarification -> 200 OK ──────────────────
    {
      const vaguePayload = {
        projectId: "proj-vague-e2e",
        input: "Fix stuff",
      };

      const res = await httpPost(port, "/projects", authHeadersAlpha, vaguePayload);
      assert(res.statusCode === 200, "Vague input should return 200 OK for needs_clarification");
      const json = res.json<ApiResponseSuccess<any>>();
      assert(json.data.status === "needs_clarification", "Status must be needs_clarification");
      assert(json.data.clarificationQuestions.length > 0, "Clarification questions must be present");
      console.log("STEP 4: POST /projects vague input returned 200 OK with clarification questions");
    }

    // ── STEP 5: POST /projects Duplicate Project ID -> 409 Conflict ─────────────
    {
      const dupePayload = {
        projectId: newProjectId, // Already created in STEP 2
        input: "Objective: Duplicate test\nRequirements:\n- Duplicate\nConstraints:\n- None\nDeliverables:\n- None\nAcceptance Criteria:\n- None",
      };

      const res = await httpPost(port, "/projects", authHeadersAlpha, dupePayload);
      assert(res.statusCode === 409, "Duplicate project ID must return 409 Conflict");
      const json = res.json<ApiResponseError>();
      assert(json.error.code === "PROJECT_EXISTS", "Error code must be PROJECT_EXISTS");
      console.log("STEP 5: Duplicate project submission rejected with 409 Conflict");
    }

    // ── STEP 6: POST /projects/:projectId/plan (Governed Boss Planning Command)
    const planId = `plan-e2e-${Date.now()}`;
    {
      // Valid request by Client Alpha
      const res = await httpPost(port, `/projects/${newProjectId}/plan`, authHeadersAlpha, { planId });
      assert(res.statusCode === 201, `POST /projects/:projectId/plan should return 201 Created (got ${res.statusCode}: ${res.body})`);
      const json = res.json<ApiResponseSuccess<any>>();
      assert(json.success === true, "Response success must be true");
      assert(json.data.planId === planId, "Plan ID must match");
      assert(json.data.projectId === newProjectId, "ProjectId must match target project");
      assert(json.data.plannedBy === boss.id, "PlannedBy must be authoritative Boss agent ID");
      assert(Array.isArray(json.data.tasks), "Tasks must be an array of blueprint PlannedTask objects");
      assert(json.data.tasks.length > 0, "Plan tasks array must not be empty");
      console.log("STEP 6a: POST /projects/:projectId/plan succeeded: 201 Created for client-alpha");

      // Unauthorized request by Client Beta
      const betaPlan = await httpPost(port, `/projects/${newProjectId}/plan`, authHeadersBeta, { planId: "plan-beta-fail" });
      assert(betaPlan.statusCode === 403, "Client Beta must receive 403 Forbidden attempting to plan Client Alpha's project");
      console.log("STEP 6b: Client Beta planning attempt rejected with 403 Forbidden");

      // Duplicate plan ID request
      const dupePlan = await httpPost(port, `/projects/${newProjectId}/plan`, authHeadersAlpha, { planId });
      assert(dupePlan.statusCode === 409, "Duplicate plan ID must return 409 Conflict");
      const dupeJson = dupePlan.json<ApiResponseError>();
      assert(dupeJson.error.code === "PLAN_EXISTS", "Error code must be PLAN_EXISTS");
      console.log("STEP 6c: Duplicate plan submission rejected with 409 Conflict");
    }

    // ── STEP 7: POST /projects/:projectId/execute-plan (Governed Plan Execution Command)
    {
      // Valid plan execution by Client Alpha
      const res = await httpPost(port, `/projects/${newProjectId}/execute-plan`, authHeadersAlpha);
      assert(res.statusCode === 201, `POST /projects/:projectId/execute-plan should return 201 Created (got ${res.statusCode}: ${res.body})`);
      const json = res.json<ApiResponseSuccess<any>>();
      assert(json.success === true, "Response success must be true");
      assert(json.data.projectId === newProjectId, "ProjectId must match target project");
      assert(json.data.planId === planId, "PlanId must match created plan");
      assert(Array.isArray(json.data.tasks), "Tasks must be an array");
      assert(json.data.tasks.length > 0, "Materialized tasks array must not be empty");

      // Verify task invariants: queued, unassigned, unexecuted
      for (const t of json.data.tasks) {
        assert(t.status === "queued", `Task status must be 'queued' (got ${t.status})`);
        assert(t.assignedTo === null, `Task assignedTo must be null (got ${t.assignedTo})`);
        assert(t.spent === 0, `Task spent must be 0 (got ${t.spent})`);
        assert(t.createdBy === boss.id, "Task createdBy must be authoritative Boss ID");
      }
      assert(worker.status === "idle", "Worker agent must remain idle (no tasks assigned/started)");
      console.log("STEP 7a: POST /projects/:projectId/execute-plan succeeded: 201 Created (tasks queued & unassigned)");

      // Unauthorized request by Client Beta
      const betaExec = await httpPost(port, `/projects/${newProjectId}/execute-plan`, authHeadersBeta);
      assert(betaExec.statusCode === 403, "Client Beta execute-plan attempt must receive 403 Forbidden");
      console.log("STEP 7b: Client Beta execute-plan attempt rejected with 403 Forbidden");

      // Unauthenticated request
      const unauthExec = await httpPost(port, `/projects/${newProjectId}/execute-plan`, {});
      assert(unauthExec.statusCode === 401, "Unauthenticated execute-plan attempt must receive 401 Unauthorized");
      console.log("STEP 7c: Unauthenticated execute-plan attempt rejected with 401 Unauthorized");

      // Duplicate plan execution attempt -> 409 Conflict
      const dupeExec = await httpPost(port, `/projects/${newProjectId}/execute-plan`, authHeadersAlpha);
      assert(dupeExec.statusCode === 409, "Duplicate plan execution must return 409 Conflict");
      const dupeJson = dupeExec.json<ApiResponseError>();
      assert(dupeJson.error.code === "PLAN_ALREADY_EXECUTED", "Error code must be PLAN_ALREADY_EXECUTED");
      console.log("STEP 7d: Duplicate plan execution attempt rejected with 409 Conflict");
    }

    // ── STEP 8: POST /projects/:projectId/allocate-manager (Governed Manager Allocation Command)
    {
      organization.addManager(manager.id, "frontend");
      const e2eMeeting = conference.createMeeting({
        id: `meeting-e2e-${Date.now()}`,
        projectId: newProjectId,
        calledBy: boss.id,
        participants: [manager.id],
        agenda: "Allocate manager for newProjectId",
      });
      conference.startMeeting(e2eMeeting.id);

      const newProjTasks = planExecutionService.get(planId) || [];
      assert(newProjTasks.length > 0, "Materialized tasks for newProjectId must exist");
      const targetTaskId = newProjTasks[0].id;

      const e2eDecision = conference.createDecision({
        id: `decision-e2e-${Date.now()}`,
        meetingId: e2eMeeting.id,
        decidedBy: boss.id,
        decisionType: "ASSIGN_MANAGER",
        summary: "Assign manager-api-e2e to tasks",
        taskIds: [targetTaskId],
        managerId: manager.id,
      });

      const allocPayload = {
        allocationId: `alloc-e2e-${Date.now()}`,
        meetingId: e2eMeeting.id,
        decisionId: e2eDecision.id,
        managerId: manager.id,
        taskIds: [targetTaskId],
      };

      const res = await httpPost(port, `/projects/${newProjectId}/allocate-manager`, authHeadersAlpha, allocPayload);
      assert(res.statusCode === 201, `POST /projects/:projectId/allocate-manager should return 201 Created (got ${res.statusCode}: ${res.body})`);
      const json = res.json<ApiResponseSuccess<any>>();
      assert(json.success === true, "Response success must be true");
      assert(json.data.allocationId === allocPayload.allocationId, "Allocation ID must match");
      assert(json.data.projectId === newProjectId, "ProjectId must match target project");
      assert(json.data.managerId === manager.id, "ManagerId must match");
      assert(json.data.status === "PROPOSED", "Allocation status MUST be 'PROPOSED'");
      assert(json.data.assignedBy === boss.id, "AssignedBy must be authoritative Boss ID");

      assert(worker.status === "idle", "Worker agent must remain idle (no workers assigned/executed)");
      console.log("STEP 8a: POST /projects/:projectId/allocate-manager succeeded: 201 Created (status remains PROPOSED)");

      const betaAlloc = await httpPost(port, `/projects/${newProjectId}/allocate-manager`, authHeadersBeta, {
        ...allocPayload,
        allocationId: `alloc-beta-fail`,
      });
      assert(betaAlloc.statusCode === 403, "Client Beta allocate-manager attempt must receive 403 Forbidden");
      console.log("STEP 8b: Client Beta allocate-manager attempt rejected with 403 Forbidden");

      const dupeAlloc = await httpPost(port, `/projects/${newProjectId}/allocate-manager`, authHeadersAlpha, allocPayload);
      assert(dupeAlloc.statusCode === 409, "Duplicate allocation must return 409 Conflict");
      const dupeJson = dupeAlloc.json<ApiResponseError>();
      assert(dupeJson.error.code === "ALLOCATION_EXISTS", "Error code must be ALLOCATION_EXISTS");
      console.log("STEP 8c: Duplicate allocation attempt rejected with 409 Conflict");

      // Save allocationId for STEP 9
      (globalThis as any).e2eAllocationId = allocPayload.allocationId;
    }

    // ── STEP 9: POST /projects/:projectId/approve-allocation (Governed Boss Approval Command)
    {
      const targetAllocId = (globalThis as any).e2eAllocationId;
      const approvePayload = {
        allocationId: targetAllocId,
        approvedBy: boss.id,
      };

      // Security check: Manager approval attempt -> 403
      const mgrApprove = await httpPost(port, `/projects/${newProjectId}/approve-allocation`, authHeadersAlpha, {
        allocationId: targetAllocId,
        approvedBy: manager.id,
      });
      assert(mgrApprove.statusCode === 403, "Manager approval attempt must receive 403 Forbidden");
      console.log("STEP 9a: Manager approval attempt rejected with 403 Forbidden");

      // Security check: Worker approval attempt -> 403
      const wkrApprove = await httpPost(port, `/projects/${newProjectId}/approve-allocation`, authHeadersAlpha, {
        allocationId: targetAllocId,
        approvedBy: worker.id,
      });
      assert(wkrApprove.statusCode === 403, "Worker approval attempt must receive 403 Forbidden");
      console.log("STEP 9b: Worker approval attempt rejected with 403 Forbidden");

      // Security check: Client Beta approval attempt -> 403
      const betaApprove = await httpPost(port, `/projects/${newProjectId}/approve-allocation`, authHeadersBeta, approvePayload);
      assert(betaApprove.statusCode === 403, "Client Beta approve-allocation attempt must receive 403 Forbidden");
      console.log("STEP 9c: Client Beta approve-allocation attempt rejected with 403 Forbidden");

      // Valid Boss approval by Client Alpha over HTTP socket
      const res = await httpPost(port, `/projects/${newProjectId}/approve-allocation`, authHeadersAlpha, approvePayload);
      assert(res.statusCode === 200, `POST /projects/:projectId/approve-allocation should return 200 OK (got ${res.statusCode}: ${res.body})`);
      const json = res.json<ApiResponseSuccess<any>>();
      assert(json.success === true, "Response success must be true");
      assert(json.data.allocationId === targetAllocId, "Allocation ID must match");
      assert(json.data.status === "APPROVED", "Allocation status MUST transition to 'APPROVED'");
      assert(json.data.status !== "ACTIVE", "Approved allocation MUST NOT be active");

      // Verify worker state remains strictly idle and untouched
      assert(worker.status === "idle", "Worker agent must remain idle (no tasks assigned/scheduled/executed)");
      console.log("STEP 9d: POST /projects/:projectId/approve-allocation succeeded: 200 OK (status transitions to APPROVED, NOT ACTIVE)");

      // Duplicate approval attempt -> 409 Conflict
      const dupeApprove = await httpPost(port, `/projects/${newProjectId}/approve-allocation`, authHeadersAlpha, approvePayload);
      assert(dupeApprove.statusCode === 409, "Duplicate approval attempt must return 409 Conflict");
      const dupeJson = dupeApprove.json<ApiResponseError>();
      assert(dupeJson.error.code === "ALLOCATION_ALREADY_APPROVED", "Error code must be ALLOCATION_ALREADY_APPROVED");
      console.log("STEP 9e: Duplicate approval attempt rejected with 409 Conflict");
    }

    // ── STEP 10: Read Endpoints GET /agents & GET /tasks ─────────────────────
    {
      const resAgents = await httpGet(port, "/agents", authHeadersAlpha);
      assert(resAgents.statusCode === 200, "GET /agents should return 200");
      const agentsJson = resAgents.json<ApiResponseSuccess<any[]>>();
      assert(agentsJson.data.length === 4, "Should return 4 agents");

      const resTask = await httpGet(port, `/tasks/${taskId}`, authHeadersAlpha);
      assert(resTask.statusCode === 200, "GET /tasks/:taskId should return 200");
      console.log("STEP 10: GET /agents and GET /tasks/:taskId verified");
    }

    // ── STEP 11: Unauthorized & Unauthenticated Rejections ────────────────────
    {
      const resUnauth = await httpPost(port, "/projects", {}, { input: "Build feature" });
      assert(resUnauth.statusCode === 401, "Unauthenticated POST /projects must return 401 Unauthorized");
      console.log("STEP 11: Unauthenticated POST /projects rejected with 401 Unauthorized");
    }

    console.log(`
── GOVERNED CLIENT PROJECT INTAKE COMMAND E2E SUMMARY ───────────────────
HTTP API LAYER RUNNING ON LOCAL PORT ${port}
COMMAND ENDPOINT TESTED: POST /projects
PIPELINE FLOW: Client → Authentication → RequirementUnderstandingService
               → ProjectIntakeService (Boss Intake) → ClientMonitoring Registration
AUTHENTICATION: Authoritative ApiAuthContext.clientId (client-alpha)
SECURITY & AUTHORIZATION: Client Alpha GET /projects/:id (200), Client Beta (403)
SAFE SERIALIZATION: Allowlist DTOs verified (201 Created & 200 Needs Clarification)
SERVER LIFECYCLE: Clean HTTP server shutdown in try...finally block
──────────────────────────────────────────────────────────────────────────
`);

    console.log("✅ Governed Client Project Intake Command E2E integration test passed.");
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
