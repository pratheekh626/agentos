import type { Agent } from "../../core/Agent";

import {
  PermissionEngine,
} from "../../governance/PermissionEngine";

import {
  PolicyEngine,
  type PolicyDecision,
} from "../../governance/PolicyEngine";

import {
  WalletService,
} from "../Wallet";

import {
  BudgetService,
} from "../Budget";

import {
  TransactionService,
  type Transaction,
} from "../Transactions";

import {
  SecurityGateway,
} from "../../security/SecurityGateway";

export interface CreditRequest {
  id: string;

  agent: Agent;

  amount: number;

  reason: string;

  taskId: string | null;

  riskScore: number;

  budgetId: string;
}

export interface CreditResult {
  decision: PolicyDecision;

  transaction: Transaction | null;

  reason: string;
}

export class CreditEngine {
  constructor(
    private readonly permissionEngine: PermissionEngine,
    private readonly policyEngine: PolicyEngine,
    private readonly walletService: WalletService,
    private readonly budgetService: BudgetService,
    private readonly transactionService: TransactionService,
    private readonly securityGateway: SecurityGateway
  ) {}

  requestCredits(
    request: CreditRequest
  ): CreditResult {
    const {
      id,
      agent,
      amount,
      reason,
      taskId,
      riskScore,
      budgetId,
    } = request;

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return {
        decision: "DENY",
        transaction: null,
        reason:
          "Credit amount must be positive",
      };
    }

    const security = this.securityGateway.check({
      agent,
      action: "spend_credits",
      resource: `budget:${budgetId}`, 
      amount,
      repeatedFailures: 0,
      unusualActivity: false,
      sensitiveAction: false,
      activity: {
        agentId: agent.id,
        recentActions: 1,
        failedActions: 0,
        deniedActions: 0,
        spendingToday: amount,
        averageDailySpending: Math.max(amount * 2, 1000),
        delegationsToday: 0,
        averageDailyDelegations: 1,
        activityPerHour: 1,
        normalActivityPerHour: 1,
      },
    });

    if (security.decision === "DENY") {
      return {
        decision: "DENY",
        transaction: null,
        reason: security.reason,
      };
    }

    if (security.decision === "ESCALATE") {
      return {
        decision: "ESCALATE",
        transaction: null,
        reason: security.reason,
      };
    }

    if (
      !this.permissionEngine.hasPermission(
        agent,
        "spend_credits"
      )
    ) {
      return {
        decision: "DENY",
        transaction: null,
        reason:
          "Agent does not have credit spending permission",
      };
    }

    const wallet =
      this.walletService.getWallet(
        agent.id
      );

    if (!wallet) {
      return {
        decision: "DENY",
        transaction: null,
        reason:
          "Agent wallet does not exist",
      };
    }

    if (wallet.frozen) {
      return {
        decision: "DENY",
        transaction: null,
        reason:
          "Agent wallet is frozen",
      };
    }

    if (amount > wallet.balance) {
      return {
        decision: "DENY",
        transaction: null,
        reason:
          "Insufficient wallet balance",
      };
    }

    if (
      amount > wallet.maxTransaction
    ) {
      return {
        decision: "DENY",
        transaction: null,
        reason:
          "Transaction exceeds wallet limit",
      };
    }

    if (
      wallet.spentToday + amount >
      wallet.dailyLimit
    ) {
      return {
        decision: "DENY",
        transaction: null,
        reason:
          "Wallet daily spending limit exceeded",
      };
    }

    if (
      !this.budgetService.canSpend(
        budgetId,
        amount
      )
    ) {
      return {
        decision: "DENY",
        transaction: null,
        reason:
          "Budget does not allow this transaction",
      };
    }

    const policy =
      this.policyEngine.evaluate({
        agent,
        action: "spend_credits",
        riskScore,
        amount,
      });

    if (
      policy.decision === "DENY"
    ) {
      const transaction =
        this.transactionService.create(
          id,
          agent.id,
          "debit",
          amount,
          reason,
          taskId
        );

      this.transactionService.reject(
        id,
        policy.reason
      );

      return {
        decision: "DENY",
        transaction:
          this.transactionService.get(id) ?? transaction,
        reason: policy.reason,
      };
    }

    if (
      policy.decision === "ESCALATE"
    ) {
      const transaction =
        this.transactionService.create(
          id,
          agent.id,
          "debit",
          amount,
          reason,
          taskId
        );

      return {
        decision: "ESCALATE",
        transaction,
        reason: policy.reason,
      };
    }

    const transaction =
      this.transactionService.create(
        id,
        agent.id,
        "debit",
        amount,
        reason,
        taskId
      );

    this.transactionService.approve(id);

    this.walletService.debit(
      agent.id,
      amount
    );

    this.budgetService.spend(
      budgetId,
      amount
    );

    const completed =
      this.transactionService.complete(
        id
      );

    return {
      decision: "ALLOW",
      transaction: completed,
      reason: policy.reason,
    };
  }
}
