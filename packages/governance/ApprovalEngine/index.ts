export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected";

export interface ApprovalRequest {
  id: string;

  requestedBy: string;

  action: string;

  reason: string;

  status: ApprovalStatus;

  createdAt: string;

  resolvedAt: string | null;

  resolvedBy: string | null;
}

export class ApprovalEngine {
  private requests = new Map<
    string,
    ApprovalRequest
  >();

  createRequest(
    id: string,
    requestedBy: string,
    action: string,
    reason: string
  ): ApprovalRequest {
    const request: ApprovalRequest = {
      id,
      requestedBy,
      action,
      reason,
      status: "pending",
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
    };

    this.requests.set(id, request);

    return request;
  }

  approve(
    requestId: string,
    approvedBy: string
  ): ApprovalRequest {
    return this.resolve(
      requestId,
      "approved",
      approvedBy
    );
  }

  reject(
    requestId: string,
    rejectedBy: string
  ): ApprovalRequest {
    return this.resolve(
      requestId,
      "rejected",
      rejectedBy
    );
  }

  get(requestId: string): ApprovalRequest | undefined {
    return this.requests.get(requestId);
  }

  private resolve(
    requestId: string,
    status: "approved" | "rejected",
    resolvedBy: string
  ): ApprovalRequest {
    const request = this.requests.get(requestId);

    if (!request) {
      throw new Error(
        `Approval request not found: ${requestId}`
      );
    }

    if (request.status !== "pending") {
      throw new Error(
        `Approval request already resolved: ${requestId}`
      );
    }

    const updated: ApprovalRequest = {
      ...request,
      status,
      resolvedAt: new Date().toISOString(),
      resolvedBy,
    };

    this.requests.set(requestId, updated);

    return updated;
  }
}
