import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentRegistry } from "../../agents/AgentRegistry";
import type { Agent } from "../../core/Agent";
import type { Task } from "../../core/Task";
import type {
  ClientMonitoringService,
  ClientAuthContext,
} from "../../events/ClientMonitoring";

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

// ── Service Container & Read Adapters ────────────────────────────────────────

export interface TaskProvider {
  getTask(taskId: string): Task | null;
  getTasksForProject?(projectId: string): Task[];
}

export interface ProjectProvider {
  getProject(projectId: string): { id: string; status: string; title?: string } | null;
}

export interface ApiServicesContainer {
  registry: AgentRegistry;
  monitoringService: ClientMonitoringService;
  taskProvider?: TaskProvider;
  projectProvider?: ProjectProvider;
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

  handleRequest(req: IncomingMessage, res: ServerResponse): void {
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

      if (method !== "GET") {
        throw new ApiError(405, "METHOD_NOT_ALLOWED", `Method ${method} not allowed`);
      }

      // Route: GET /health (Unauthenticated public health check)
      if (pathname === "/health") {
        return sendJson(200, {
          success: true,
          data: { status: "ok", service: "AGENTOS API Gateway" },
          timestamp,
        });
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

      const parts = pathname.split("/").filter(Boolean);

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
