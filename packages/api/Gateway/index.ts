import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentRegistry } from "../../agents/AgentRegistry";
import type { Agent } from "../../core/Agent";
import type { Task } from "../../core/Task";
import type {
  ClientMonitoringService,
  ClientAuthContext,
} from "../../events/ClientMonitoring";
import type { RequirementUnderstandingService } from "../../agents/RequirementUnderstanding";
import type { ProjectIntakeService, Project } from "../../agents/ProjectIntake";
import type { BossPlanningService, ExecutionPlan } from "../../agents/BossPlanning";
import type { PlanExecutionService } from "../../orchestration/PlanExecution";

// ── Authentication Boundary ──────────────────────────────────────────────────

export interface ApiAuthContext {
  isAuthenticated: boolean;
  clientId: string | null;
  authorizedProjectIds: string[];
}

export interface ApiAuthenticator {
  authenticate(req: IncomingMessage): ApiAuthContext;
}

/**
 * Development & testing authenticator reading headers:
 * x-client-id, x-authorized-projects (comma-separated).
 *
 * NOTE: This is strictly a development/testing context. Production authentication
 * will be implemented by replacing this with a JWT/OAuth ApiAuthenticator implementation.
 */
export class HeaderDevAuthenticator implements ApiAuthenticator {
  authenticate(req: IncomingMessage): ApiAuthContext {
    const clientIdHeader = req.headers["x-client-id"];
    const clientId = Array.isArray(clientIdHeader) ? clientIdHeader[0] : clientIdHeader;

    if (!clientId || !clientId.trim()) {
      return {
        isAuthenticated: false,
        clientId: null,
        authorizedProjectIds: [],
      };
    }

    const projectsHeader = req.headers["x-authorized-projects"];
    const projectsRaw = Array.isArray(projectsHeader) ? projectsHeader[0] : projectsHeader;
    const authorizedProjectIds = projectsRaw
      ? projectsRaw.split(",").map((p) => p.trim()).filter(Boolean)
      : [];

    return {
      isAuthenticated: true,
      clientId: clientId.trim(),
      authorizedProjectIds,
    };
  }
}

// ── Response & Error Structures ──────────────────────────────────────────────

export interface ApiResponseSuccess<T> {
  success: true;
  data: T;
  timestamp: string;
}

export interface ApiResponseError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

export type ApiResponse<T> = ApiResponseSuccess<T> | ApiResponseError;

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ── Allowlist-based Safe Serialization ───────────────────────────────────────

export interface SafeAgentDto {
  id: string;
  name: string;
  role: string;
  status: string;
  managerId: string | null;
}

export interface SafeTaskDto {
  id: string;
  title: string;
  description: string;
  assignedTo: string | null;
  createdBy: string;
  status: string;
  priority: string;
  budget: number;
  spent: number;
  createdAt: string;
  updatedAt: string;
}

export interface SafeProjectDto {
  projectId: string;
  clientId: string;
  objective: string;
  status: string;
  createdAt: string;
}

export interface SafePlannedTaskDto {
  id: string;
  title: string;
  description: string;
  priority: string;
  budget: number;
  dependencies: string[];
}

export interface SafeExecutionPlanDto {
  planId: string;
  projectId: string;
  plannedBy: string;
  tasks: SafePlannedTaskDto[];
  createdAt: string;
}

export function toSafeAgent(agent: Agent): SafeAgentDto {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    managerId: agent.managerId ?? null,
  };
}

export function toSafeTask(task: Task): SafeTaskDto {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    assignedTo: task.assignedTo ?? null,
    createdBy: task.createdBy,
    status: task.status,
    priority: task.priority,
    budget: task.budget,
    spent: task.spent,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function toSafeProject(project: Project): SafeProjectDto {
  return {
    projectId: project.id,
    clientId: project.clientId,
    objective: project.objective,
    status: project.status,
    createdAt: project.createdAt,
  };
}

export function toSafeExecutionPlan(plan: ExecutionPlan): SafeExecutionPlanDto {
  return {
    planId: plan.id,
    projectId: plan.projectId,
    plannedBy: plan.plannedBy,
    tasks: plan.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      priority: t.priority,
      budget: t.budget,
      dependencies: [...t.dependencies],
    })),
    createdAt: plan.createdAt,
  };
}

// ── Service Container & Read Adapters ────────────────────────────────────────

export interface TaskProvider {
  getTask(taskId: string): Task | null;
  getTasksForProject?(projectId: string): Task[];
}

export interface ProjectProvider {
  getProject(projectId: string): { id: string; status: string; title?: string; requirementId?: string; clientId?: string } | null;
}

export interface ApiServicesContainer {
  registry: AgentRegistry;
  monitoringService: ClientMonitoringService;
  requirementService?: RequirementUnderstandingService;
  projectIntakeService?: ProjectIntakeService;
  planningService?: BossPlanningService;
  planExecutionService?: PlanExecutionService;
  bossAgentId?: string;
  taskProvider?: TaskProvider;
  projectProvider?: ProjectProvider;
}

// ── Helper: Read JSON Body ───────────────────────────────────────────────────

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.destroy();
        reject(new ApiError(400, "BAD_REQUEST", "Request payload too large"));
      }
    });
    req.on("end", () => {
      if (!data.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new ApiError(400, "BAD_REQUEST", "Invalid JSON payload"));
      }
    });
    req.on("error", (err) => reject(err));
  });
}

// ── Server & Gateway ─────────────────────────────────────────────────────────

export interface ApiGatewayOptions {
  authenticator?: ApiAuthenticator;
}

export class ApiGatewayServer {
  private server: http.Server | null = null;
  private readonly authenticator: ApiAuthenticator;

  constructor(
    private readonly services: ApiServicesContainer,
    options: ApiGatewayOptions = {}
  ) {
    this.authenticator = options.authenticator ?? new HeaderDevAuthenticator();
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const timestamp = new Date().toISOString();

    const sendJson = (statusCode: number, payload: ApiResponse<unknown>) => {
      res.writeHead(statusCode, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(payload));
    };

    const sendError = (err: ApiError | Error) => {
      if (err instanceof ApiError) {
        sendJson(err.statusCode, {
          success: false,
          error: { code: err.code, message: err.message, details: err.details },
          timestamp,
        });
      } else {
        sendJson(500, {
          success: false,
          error: { code: "INTERNAL_ERROR", message: err.message || "Internal server error" },
          timestamp,
        });
      }
    };

    try {
      const method = req.method?.toUpperCase() ?? "GET";
      const urlString = req.url ?? "/";

      const host = req.headers.host ?? "localhost";
      const parsedUrl = new URL(urlString, `http://${host}`);
      const pathname = parsedUrl.pathname;
      const parts = pathname.split("/").filter(Boolean);

      // Route: GET /health (Unauthenticated public health check)
      if (method === "GET" && pathname === "/health") {
        return sendJson(200, {
          success: true,
          data: { status: "ok", service: "AGENTOS API Gateway" },
          timestamp,
        });
      }

      // Route: POST /projects/:projectId/plan (Governed Boss Planning Command)
      if (method === "POST" && parts[0] === "projects" && parts.length === 3 && parts[2] === "plan") {
        const projectId = parts[1];
        if (!projectId) {
          throw new ApiError(400, "BAD_REQUEST", "Project ID is required");
        }

        const authContext = this.authenticator.authenticate(req);
        if (!authContext.isAuthenticated || !authContext.clientId) {
          throw new ApiError(401, "UNAUTHENTICATED", "Authentication required. Missing or invalid authentication credentials.");
        }

        const clientAuth: ClientAuthContext = {
          clientId: authContext.clientId,
          authorizedProjectIds: authContext.authorizedProjectIds,
        };

        // Check authorization via ClientMonitoringService
        const summary = this.services.monitoringService.getProjectSummary(clientAuth, projectId);
        if (!summary && !clientAuth.authorizedProjectIds.includes(projectId)) {
          throw new ApiError(403, "FORBIDDEN", `Access denied for project: ${projectId}`);
        }

        // Retrieve project
        const project = (this.services.projectIntakeService?.get(projectId)
          ?? this.services.projectProvider?.getProject(projectId)) as any;

        if (!project) {
          throw new ApiError(404, "NOT_FOUND", `Project not found: ${projectId}`);
        }

        // Retrieve requirement
        const requirementId = project.requirementId;
        const requirement = requirementId ? this.services.requirementService?.get(requirementId) : undefined;

        if (!requirement || requirement.status !== "ready") {
          throw new ApiError(400, "BAD_REQUEST", "Requirement is not ready for planning");
        }

        if (!this.services.planningService) {
          throw new ApiError(500, "SERVICE_UNAVAILABLE", "BossPlanningService is not configured");
        }

        const bossId = this.services.bossAgentId ?? this.services.registry.getByRole("boss")[0]?.id;
        if (!bossId) {
          throw new ApiError(500, "SERVICE_UNAVAILABLE", "No registered Boss agent available for planning");
        }

        const body = await readJsonBody(req);
        const planId = (body.planId || `plan-${Date.now()}-${Math.floor(Math.random() * 1000)}`).trim();

        let planningResult;
        try {
          planningResult = this.services.planningService.plan(
            planId,
            project,
            requirement,
            bossId,
            timestamp
          );
        } catch (err: any) {
          if (err.message && err.message.includes("Plan already exists")) {
            throw new ApiError(409, "PLAN_EXISTS", `A plan with ID '${planId}' already exists`);
          }
          throw err;
        }

        if (planningResult.decision === "CREATED" && planningResult.plan) {
          return sendJson(201, {
            success: true,
            data: toSafeExecutionPlan(planningResult.plan),
            timestamp,
          });
        }

        throw new ApiError(400, "PLANNING_REJECTED", planningResult.reason || "Planning request rejected");
      }

      // Route: POST /projects/:projectId/execute-plan (Governed Plan Execution Command)
      if (method === "POST" && parts[0] === "projects" && parts.length === 3 && parts[2] === "execute-plan") {
        const projectId = parts[1];
        if (!projectId) {
          throw new ApiError(400, "BAD_REQUEST", "Project ID is required");
        }

        const authContext = this.authenticator.authenticate(req);
        if (!authContext.isAuthenticated || !authContext.clientId) {
          throw new ApiError(401, "UNAUTHENTICATED", "Authentication required. Missing or invalid authentication credentials.");
        }

        const clientAuth: ClientAuthContext = {
          clientId: authContext.clientId,
          authorizedProjectIds: authContext.authorizedProjectIds,
        };

        // Check authorization via ClientMonitoringService
        const summary = this.services.monitoringService.getProjectSummary(clientAuth, projectId);
        if (!summary && !clientAuth.authorizedProjectIds.includes(projectId)) {
          throw new ApiError(403, "FORBIDDEN", `Access denied for project: ${projectId}`);
        }

        // Retrieve project
        const project = (this.services.projectIntakeService?.get(projectId)
          ?? this.services.projectProvider?.getProject(projectId)) as any;

        if (!project) {
          throw new ApiError(404, "NOT_FOUND", `Project not found: ${projectId}`);
        }

        if (!this.services.planningService) {
          throw new ApiError(500, "SERVICE_UNAVAILABLE", "BossPlanningService is not configured");
        }

        if (!this.services.planExecutionService) {
          throw new ApiError(500, "SERVICE_UNAVAILABLE", "PlanExecutionService is not configured");
        }

        // Retrieve ExecutionPlan for target project
        const body = await readJsonBody(req);
        let plan: ExecutionPlan | undefined;

        if (body.planId && typeof body.planId === "string") {
          plan = this.services.planningService.get(body.planId.trim());
          if (plan && plan.projectId !== projectId) {
            plan = undefined;
          }
        }

        if (!plan) {
          plan = this.services.planningService.getAll().find((p) => p.projectId === projectId);
        }

        if (!plan) {
          throw new ApiError(404, "NOT_FOUND", `Execution plan not found for project: ${projectId}`);
        }

        // Execute plan via PlanExecutionService
        const result = this.services.planExecutionService.execute(plan);

        if (result.decision === "REJECTED") {
          if (result.reason.includes("Plan already executed")) {
            throw new ApiError(409, "PLAN_ALREADY_EXECUTED", result.reason);
          }
          throw new ApiError(400, "PLAN_EXECUTION_REJECTED", result.reason);
        }

        // Register materialized tasks in ClientMonitoringService
        for (const task of result.tasks) {
          this.services.monitoringService.registerProjectTask(projectId, task.id);
        }

        return sendJson(201, {
          success: true,
          data: {
            projectId: project.id,
            planId: plan.id,
            tasks: result.tasks.map(toSafeTask),
            createdAt: timestamp,
          },
          timestamp,
        });
      }

      // Route: POST /projects (Governed Client Project Intake)
      if (method === "POST" && pathname === "/projects") {
        const authContext = this.authenticator.authenticate(req);
        if (!authContext.isAuthenticated || !authContext.clientId) {
          throw new ApiError(401, "UNAUTHENTICATED", "Authentication required. Missing or invalid authentication credentials.");
        }

        const clientId = authContext.clientId; // Authoritative client identity
        const body = await readJsonBody(req);

        const userRawInput = (body.input || body.description || "").trim();
        if (!userRawInput) {
          throw new ApiError(400, "BAD_REQUEST", "Project description/input is required");
        }

        if (!this.services.requirementService) {
          throw new ApiError(500, "SERVICE_UNAVAILABLE", "RequirementUnderstandingService is not configured");
        }

        const reqId = `req-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const projectId = (body.projectId || `proj-${Date.now()}-${Math.floor(Math.random() * 1000)}`).trim();

        // 1. Requirement Understanding Service
        const requirement = this.services.requirementService.create({
          id: reqId,
          clientId, // Authoritative client identity
          input: userRawInput,
          createdAt: timestamp,
        });

        if (requirement.status === "needs_clarification") {
          return sendJson(200, {
            success: true,
            data: {
              status: "needs_clarification",
              requirementId: requirement.id,
              clarificationQuestions: requirement.clarificationQuestions,
              summary: "Requirement needs clarification before project intake",
            },
            timestamp,
          });
        }

        // 2. Project Intake Service
        if (!this.services.projectIntakeService) {
          throw new ApiError(500, "SERVICE_UNAVAILABLE", "ProjectIntakeService is not configured");
        }

        const bossId = this.services.bossAgentId ?? this.services.registry.getByRole("boss")[0]?.id;
        if (!bossId) {
          throw new ApiError(500, "SERVICE_UNAVAILABLE", "No registered Boss agent available for intake");
        }

        let intakeResult;
        try {
          intakeResult = this.services.projectIntakeService.intake(
            projectId,
            bossId,
            requirement,
            timestamp
          );
        } catch (err: any) {
          if (err.message && err.message.includes("Project already exists")) {
            throw new ApiError(409, "PROJECT_EXISTS", `A project with ID '${projectId}' already exists`);
          }
          throw err;
        }

        if (intakeResult.decision === "ACCEPTED" && intakeResult.project) {
          // Register client project in ClientMonitoringService
          this.services.monitoringService.registerClientProject(clientId, projectId);
          if (!authContext.authorizedProjectIds.includes(projectId)) {
            authContext.authorizedProjectIds.push(projectId);
          }
          if (this.services.projectProvider && "registerProject" in this.services.projectProvider) {
            (this.services.projectProvider as any).registerProject(intakeResult.project);
          }
          return sendJson(201, {
            success: true,
            data: toSafeProject(intakeResult.project),
            timestamp,
          });
        }

        if (intakeResult.decision === "NEEDS_CLARIFICATION") {
          return sendJson(200, {
            success: true,
            data: {
              status: "needs_clarification",
              requirementId: requirement.id,
              clarificationQuestions: requirement.clarificationQuestions,
              summary: intakeResult.reason,
            },
            timestamp,
          });
        }

        throw new ApiError(400, "PROJECT_REJECTED", intakeResult.reason || "Project request rejected");
      }

      if (method !== "GET") {
        throw new ApiError(405, "METHOD_NOT_ALLOWED", `Method ${method} not allowed`);
      }

      // Authenticate request
      const authContext = this.authenticator.authenticate(req);
      if (!authContext.isAuthenticated) {
        throw new ApiError(401, "UNAUTHENTICATED", "Authentication required. Missing or invalid authentication credentials.");
      }

      const clientAuth: ClientAuthContext = {
        clientId: authContext.clientId ?? "unknown",
        authorizedProjectIds: authContext.authorizedProjectIds,
      };

      // Projects endpoints: /projects/:projectId/*
      if (parts[0] === "projects" && parts.length >= 2) {
        const projectId = parts[1];
        if (!projectId) {
          throw new ApiError(400, "BAD_REQUEST", "Project ID is required");
        }

        // GET /projects/:projectId
        if (parts.length === 2) {
          const summary = this.services.monitoringService.getProjectSummary(clientAuth, projectId);
          if (!summary) {
            throw new ApiError(403, "FORBIDDEN", `Access denied for project: ${projectId}`);
          }
          const projectInfo = this.services.projectProvider?.getProject(projectId);
          return sendJson(200, {
            success: true,
            data: {
              projectId,
              status: projectInfo?.status ?? "active",
              title: projectInfo?.title ?? `Project ${projectId}`,
            },
            timestamp,
          });
        }

        if (parts.length === 3) {
          const sub = parts[2];

          // GET /projects/:projectId/activity
          if (sub === "activity") {
            const limitParam = parsedUrl.searchParams.get("limit");
            const limit = limitParam ? parseInt(limitParam, 10) : undefined;
            if (limitParam && (isNaN(limit!) || limit! <= 0)) {
              throw new ApiError(400, "BAD_REQUEST", "Invalid limit parameter");
            }

            const activity = this.services.monitoringService.getProjectActivity(clientAuth, projectId, limit);
            if (activity.length === 0 && !clientAuth.authorizedProjectIds.includes(projectId)) {
              throw new ApiError(403, "FORBIDDEN", `Access denied for project: ${projectId}`);
            }
            return sendJson(200, { success: true, data: activity, timestamp });
          }

          // GET /projects/:projectId/summary
          if (sub === "summary") {
            const summary = this.services.monitoringService.getProjectSummary(clientAuth, projectId);
            if (!summary) {
              throw new ApiError(403, "FORBIDDEN", `Access denied for project: ${projectId}`);
            }
            return sendJson(200, { success: true, data: summary, timestamp });
          }

          // GET /projects/:projectId/tasks
          if (sub === "tasks") {
            const summary = this.services.monitoringService.getProjectSummary(clientAuth, projectId);
            if (!summary) {
              throw new ApiError(403, "FORBIDDEN", `Access denied for project: ${projectId}`);
            }
            const taskList = this.services.taskProvider?.getTasksForProject
              ? this.services.taskProvider.getTasksForProject(projectId)
              : [];
            return sendJson(200, {
              success: true,
              data: taskList.map(toSafeTask),
              timestamp,
            });
          }
        }
      }

      // Agents endpoints: /agents and /agents/:agentId
      if (parts[0] === "agents") {
        if (parts.length === 1) {
          // GET /agents
          const allAgents = this.services.registry.getAll();
          return sendJson(200, {
            success: true,
            data: allAgents.map(toSafeAgent),
            timestamp,
          });
        }
        if (parts.length === 2) {
          // GET /agents/:agentId
          const agentId = parts[1];
          const agent = this.services.registry.get(agentId);
          if (!agent) {
            throw new ApiError(404, "NOT_FOUND", `Agent not found: ${agentId}`);
          }
          return sendJson(200, {
            success: true,
            data: toSafeAgent(agent),
            timestamp,
          });
        }
      }

      // Tasks endpoint: /tasks/:taskId
      if (parts[0] === "tasks" && parts.length === 2) {
        const taskId = parts[1];
        const task = this.services.taskProvider?.getTask(taskId);
        if (!task) {
          throw new ApiError(404, "NOT_FOUND", `Task not found: ${taskId}`);
        }
        return sendJson(200, {
          success: true,
          data: toSafeTask(task),
          timestamp,
        });
      }

      throw new ApiError(404, "NOT_FOUND", `Endpoint not found: ${pathname}`);
    } catch (err) {
      sendError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  start(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(port, () => {
        const addr = this.server?.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : port;
        resolve(actualPort);
      });
      this.server.on("error", reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => {
        this.server = null;
        resolve();
      });
    });
  }
}
