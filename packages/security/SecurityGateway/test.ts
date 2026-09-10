import type { Agent } from "../../core/Agent";
import { AccessControlService } from "../AccessControl";
import { IdentityService } from "../Identity";
import { RiskEngine } from "../RiskEngine";
import { AnomalyDetectionService } from "../AnomalyDetection";
import { KillSwitchService } from "../KillSwitch";
import { WalletService } from "../../economy/Wallet";
import { SecurityGateway } from "./index";

const identityService = new IdentityService();
const accessControl = new AccessControlService(identityService);
const riskEngine = new RiskEngine();
const anomalyDetection = new AnomalyDetectionService();
const walletService = new WalletService();

const killSwitch = new KillSwitchService(
  identityService,
  walletService
);

const boss: Agent = {
  id: "boss-001",
  name: "Boss",
  role: "boss",
  managerId: null,
  status: "idle",
  permissions: {
    canDelegate: true,
    canExecuteTools: true,
    canSpendCredits: true,
    canApproveWork: true,
  },
  trustScore: 95,
  createdAt: new Date().toISOString(),
};

identityService.createIdentity({
  agentId: boss.id,
  role: boss.role,
});

const gateway = new SecurityGateway(
  identityService,
  accessControl,
  riskEngine,
  anomalyDetection,
  killSwitch
);

console.log("\nALLOW:");

const allowed = gateway.check({
  agent: boss,
  action: "read",
  resource: "project-001",
});

console.log(allowed);

if (allowed.decision !== "ALLOW") {
  throw new Error("Expected ALLOW decision");
}

console.log("\nESCALATE:");

const escalated = gateway.check({
  agent: boss,
  action: "spend_credits",
  resource: "wallet-001",
  amount: 600,
  sensitiveAction: true,
});

console.log(escalated);

if (escalated.decision !== "ESCALATE") {
  throw new Error("Expected ESCALATE decision");
}

console.log("\nDENY:");

const denied = gateway.check({
  agent: boss,
  action: "spend_credits",
  resource: "wallet-001",
  amount: 1000,
  isNewAgent: true,
  repeatedFailures: 5,
  unusualActivity: true,
  sensitiveAction: true,
});

console.log(denied);

if (denied.decision !== "DENY") {
  throw new Error("Expected DENY decision");
}

console.log("\nANOMALY ESCALATION:");

const anomalyResult = gateway.check({
  agent: boss,
  action: "read",
  resource: "project-001",
  activity: {
    agentId: boss.id,
    recentActions: 20,
    failedActions: 5,
    deniedActions: 5,
    spendingToday: 0,
    averageDailySpending: 0,
    delegationsToday: 0,
    averageDailyDelegations: 0,
    activityPerHour: 20,
    normalActivityPerHour: 2,
  },
});

console.log(anomalyResult);

if (anomalyResult.decision !== "ESCALATE") {
  throw new Error("Expected ESCALATE for anomaly");
}

console.log("\nKILL SWITCH:");

killSwitch.pauseAgent(
  boss,
  "Security test",
  "system"
);

const stopped = gateway.check({
  agent: boss,
  action: "read",
  resource: "project-001",
});

console.log(stopped);

if (stopped.decision !== "DENY") {
  throw new Error("Expected DENY for stopped agent");
}

console.log("\nSecurityGateway tests passed.");
