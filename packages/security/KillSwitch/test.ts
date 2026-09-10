import type { Agent } from "../../core/Agent";
import { AgentRegistry } from "../../agents/AgentRegistry";
import { IdentityService } from "../Identity";
import { WalletService } from "../../economy/Wallet";
import { KillSwitchService } from "./index";

const registry = new AgentRegistry();

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
  trustScore: 100,
  createdAt: new Date().toISOString(),
};

const worker: Agent = {
  id: "worker-001",
  name: "Frontend Worker",
  role: "worker",
  managerId: boss.id,
  status: "working",
  permissions: {
    canDelegate: false,
    canExecuteTools: true,
    canSpendCredits: true,
    canApproveWork: false,
  },
  trustScore: 90,
  createdAt: new Date().toISOString(),
};

const workerTwo: Agent = {
  id: "worker-002",
  name: "Backend Worker",
  role: "worker",
  managerId: boss.id,
  status: "working",
  permissions: {
    canDelegate: false,
    canExecuteTools: true,
    canSpendCredits: true,
    canApproveWork: false,
  },
  trustScore: 90,
  createdAt: new Date().toISOString(),
};

registry.register(boss);
registry.register(worker);
registry.register(workerTwo);

const identityService = new IdentityService();

identityService.createIdentity({
  agentId: boss.id,
  role: boss.role,
});

identityService.createIdentity({
  agentId: worker.id,
  role: worker.role,
});

identityService.createIdentity({
  agentId: workerTwo.id,
  role: workerTwo.role,
});

const walletService = new WalletService();

walletService.createWallet(
  boss.id,
  1000,
  500,
  300
);

walletService.createWallet(
  worker.id,
  500,
  300,
  200
);

walletService.createWallet(
  workerTwo.id,
  500,
  300,
  200
);

const killSwitch = new KillSwitchService(
  identityService,
  walletService
);

console.log("\nPAUSE AGENT:");

const pauseResult = killSwitch.pauseAgent(
  worker,
  "Suspicious tool activity detected",
  boss.id
);

console.log(pauseResult);

if (!pauseResult.success) {
  throw new Error("Expected agent pause to succeed");
}

if (worker.status !== "paused") {
  throw new Error("Expected worker to be paused");
}

if (!killSwitch.isAgentStopped(worker.id)) {
  throw new Error("Expected worker to be stopped");
}

if (killSwitch.canOperate(worker.id)) {
  throw new Error("Paused worker must not be allowed to operate");
}

console.log("\nFREEZE WALLET:");

const freezeResult = killSwitch.freezeWallet(
  workerTwo.id,
  "Abnormal spending detected",
  boss.id
);

console.log(freezeResult);

if (!freezeResult.success) {
  throw new Error("Expected wallet freeze to succeed");
}

const frozenWallet = walletService.getWallet(workerTwo.id);

if (!frozenWallet?.frozen) {
  throw new Error("Expected worker wallet to be frozen");
}

console.log("\nREVOKE IDENTITY:");

const revokeResult = killSwitch.revokeIdentity(
  workerTwo.id,
  "Identity compromise detected",
  boss.id
);

console.log(revokeResult);

if (!revokeResult.success) {
  throw new Error("Expected identity revocation to succeed");
}

if (identityService.isActive(workerTwo.id)) {
  throw new Error("Expected identity to be revoked");
}

console.log("\nEMERGENCY STOP:");

const emergencyResult = killSwitch.emergencyStop(
  [boss, worker, workerTwo],
  "Critical security incident",
  boss.id
);

console.log(emergencyResult);

if (!emergencyResult.success) {
  throw new Error("Expected emergency stop to succeed");
}

if (!killSwitch.isOrganizationStopped()) {
  throw new Error("Expected organization to be stopped");
}

if (!killSwitch.isAgentStopped(boss.id)) {
  throw new Error("Expected boss to be stopped");
}

if (!killSwitch.isAgentStopped(worker.id)) {
  throw new Error("Expected worker to remain stopped");
}

if (killSwitch.canOperate(boss.id)) {
  throw new Error("No agent should operate during emergency stop");
}

console.log("\nAUDIT EVENTS:");

const events = killSwitch.getEvents();

console.log(events);

if (events.length !== 4) {
  throw new Error(`Expected 4 kill switch events, got ${events.length}`);
}

console.log("\nEMPTY REASON:");

try {
  killSwitch.pauseAgent(
    boss,
    "",
    boss.id
  );

  throw new Error("Expected empty reason to be rejected");
} catch (error) {
  console.log((error as Error).message);
}

console.log("\nEMPTY TRIGGER:");

try {
  killSwitch.freezeWallet(
    boss.id,
    "Security test",
    ""
  );

  throw new Error("Expected empty trigger to be rejected");
} catch (error) {
  console.log((error as Error).message);
}

console.log("\nKillSwitch tests passed.");
