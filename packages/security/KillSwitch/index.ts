import type { Agent } from "../../core/Agent";
import type { IdentityService } from "../Identity";
import type { WalletService } from "../../economy/Wallet";

export type KillSwitchAction =
  | "pause_agent"
  | "freeze_wallet"
  | "revoke_identity"
  | "emergency_stop";

export interface KillSwitchEvent {
  id: string;
  action: KillSwitchAction;
  agentId: string | null;
  reason: string;
  triggeredBy: string;
  createdAt: string;
}

export interface KillSwitchResult {
  success: boolean;
  action: KillSwitchAction;
  agentId: string | null;
  reason: string;
}

export class KillSwitchService {
  private readonly stoppedAgents = new Set<string>();
  private readonly events = new Map<string, KillSwitchEvent>();
  private organizationStopped = false;

  constructor(
    private readonly identityService: IdentityService,
    private readonly walletService: WalletService
  ) {}

  pauseAgent(
    agent: Agent,
    reason: string,
    triggeredBy: string
  ): KillSwitchResult {
    this.validateReason(reason);
    this.validateTrigger(triggeredBy);

    agent.status = "paused";
    this.stoppedAgents.add(agent.id);

    this.recordEvent(
      "pause_agent",
      agent.id,
      reason,
      triggeredBy
    );

    return {
      success: true,
      action: "pause_agent",
      agentId: agent.id,
      reason: `Agent ${agent.id} has been paused`,
    };
  }

  freezeWallet(
    agentId: string,
    reason: string,
    triggeredBy: string
  ): KillSwitchResult {
    this.validateReason(reason);
    this.validateTrigger(triggeredBy);

    this.walletService.freeze(agentId);
    this.stoppedAgents.add(agentId);

    this.recordEvent(
      "freeze_wallet",
      agentId,
      reason,
      triggeredBy
    );

    return {
      success: true,
      action: "freeze_wallet",
      agentId,
      reason: `Wallet for ${agentId} has been frozen`,
    };
  }

  revokeIdentity(
    agentId: string,
    reason: string,
    triggeredBy: string
  ): KillSwitchResult {
    this.validateReason(reason);
    this.validateTrigger(triggeredBy);

    this.identityService.revokeIdentity(agentId);
    this.stoppedAgents.add(agentId);

    this.recordEvent(
      "revoke_identity",
      agentId,
      reason,
      triggeredBy
    );

    return {
      success: true,
      action: "revoke_identity",
      agentId,
      reason: `Identity for ${agentId} has been revoked`,
    };
  }

  emergencyStop(
    agents: Agent[],
    reason: string,
    triggeredBy: string
  ): KillSwitchResult {
    this.validateReason(reason);
    this.validateTrigger(triggeredBy);

    this.organizationStopped = true;

    for (const agent of agents) {
      agent.status = "paused";
      this.stoppedAgents.add(agent.id);
    }

    this.recordEvent(
      "emergency_stop",
      null,
      reason,
      triggeredBy
    );

    return {
      success: true,
      action: "emergency_stop",
      agentId: null,
      reason: "Organization emergency stop activated",
    };
  }

  isAgentStopped(agentId: string): boolean {
    return this.organizationStopped || this.stoppedAgents.has(agentId);
  }

  isOrganizationStopped(): boolean {
    return this.organizationStopped;
  }

  canOperate(agentId: string): boolean {
    if (this.organizationStopped) {
      return false;
    }

    return !this.stoppedAgents.has(agentId);
  }

  getEvent(eventId: string): KillSwitchEvent | undefined {
    const event = this.events.get(eventId);

    return event ? { ...event } : undefined;
  }

  getEvents(): KillSwitchEvent[] {
    return Array.from(this.events.values()).map((event) => ({
      ...event,
    }));
  }

  private recordEvent(
    action: KillSwitchAction,
    agentId: string | null,
    reason: string,
    triggeredBy: string
  ): void {
    const id = `killswitch-${this.events.size + 1}`;

    const event: KillSwitchEvent = {
      id,
      action,
      agentId,
      reason,
      triggeredBy,
      createdAt: new Date().toISOString(),
    };

    this.events.set(id, event);
  }

  private validateReason(reason: string): void {
    if (!reason.trim()) {
      throw new Error("Kill switch reason is required");
    }
  }

  private validateTrigger(triggeredBy: string): void {
    if (!triggeredBy.trim()) {
      throw new Error("Kill switch trigger identity is required");
    }
  }
}
