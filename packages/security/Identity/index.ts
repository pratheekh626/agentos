import { createHash } from "node:crypto";

export type IdentityStatus = "active" | "revoked";

export interface AgentIdentity {
  agentId: string;
  publicId: string;
  role: "boss" | "manager" | "worker";
  status: IdentityStatus;
  issuedAt: string;
  revokedAt: string | null;
  fingerprint: string;
}

export interface CreateIdentityInput {
  agentId: string;
  role: "boss" | "manager" | "worker";
}

export class IdentityService {
  private readonly identities = new Map<string, AgentIdentity>();

  createIdentity(input: CreateIdentityInput): AgentIdentity {
    if (this.identities.has(input.agentId)) {
      throw new Error(`Identity already exists: ${input.agentId}`);
    }

    if (!input.agentId.trim()) {
      throw new Error("Agent ID is required");
    }

    const issuedAt = new Date().toISOString();
    const publicId = `agent-${input.agentId}`;

    const fingerprint = this.createFingerprint(
      input.agentId,
      input.role,
      issuedAt
    );

    const identity: AgentIdentity = {
      agentId: input.agentId,
      publicId,
      role: input.role,
      status: "active",
      issuedAt,
      revokedAt: null,
      fingerprint,
    };

    this.identities.set(input.agentId, identity);

    return this.clone(identity);
  }

  getIdentity(agentId: string): AgentIdentity | undefined {
    const identity = this.identities.get(agentId);
    return identity ? this.clone(identity) : undefined;
  }

  getAll(): AgentIdentity[] {
    return Array.from(this.identities.values()).map((identity) =>
      this.clone(identity)
    );
  }

  revokeIdentity(agentId: string): AgentIdentity {
    const identity = this.identities.get(agentId);

    if (!identity) {
      throw new Error(`Identity not found: ${agentId}`);
    }

    if (identity.status === "revoked") {
      throw new Error(`Identity already revoked: ${agentId}`);
    }

    identity.status = "revoked";
    identity.revokedAt = new Date().toISOString();

    return this.clone(identity);
  }

  isActive(agentId: string): boolean {
    const identity = this.identities.get(agentId);
    return identity?.status === "active";
  }

  verifyIdentity(agentId: string, fingerprint: string): boolean {
    const identity = this.identities.get(agentId);

    if (!identity || identity.status !== "active") {
      return false;
    }

    return identity.fingerprint === fingerprint;
  }

  count(): number {
    return this.identities.size;
  }

  private createFingerprint(
    agentId: string,
    role: string,
    issuedAt: string
  ): string {
    return createHash("sha256")
      .update(`${agentId}:${role}:${issuedAt}`)
      .digest("hex");
  }

  private clone(identity: AgentIdentity): AgentIdentity {
    return { ...identity };
  }
}
