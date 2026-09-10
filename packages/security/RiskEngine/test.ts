import { RiskEngine } from "./index";

const riskEngine = new RiskEngine();

console.log("\nLOW RISK:");

const lowRisk = riskEngine.calculate({
  agentId: "worker-frontend",
  action: "read_repository",
  trustScore: 90,
});

console.log(lowRisk);

if (lowRisk.score !== 0 || lowRisk.level !== "low") {
  throw new Error("Expected low risk");
}

console.log("\nMEDIUM RISK:");

const mediumRisk = riskEngine.calculate({
  agentId: "worker-backend",
  action: "deploy_service",
  amount: 300,
  trustScore: 90,
  sensitiveAction: true,
});

console.log(mediumRisk);

if (mediumRisk.score !== 40) {
  throw new Error(`Expected risk score 40, got ${mediumRisk.score}`);
}

console.log("\nMEDIUM/HIGH RISK:");

const elevatedRisk = riskEngine.calculate({
  agentId: "worker-new",
  action: "transfer_credits",
  amount: 600,
  trustScore: 60,
  isNewAgent: true,
  repeatedFailures: 3,
});

console.log(elevatedRisk);

if (elevatedRisk.score !== 85) {
  throw new Error(`Expected risk score 85, got ${elevatedRisk.score}`);
}

if (elevatedRisk.level !== "high") {
  throw new Error("Expected high risk");
}

console.log("\nRISK SCORE CAPPING:");

const extremeRisk = riskEngine.calculate({
  agentId: "worker-suspicious",
  action: "admin_operation",
  amount: 1000,
  trustScore: 20,
  isNewAgent: true,
  repeatedFailures: 10,
  unusualActivity: true,
  sensitiveAction: true,
});

console.log(extremeRisk);

if (extremeRisk.score !== 100) {
  throw new Error(`Expected score to be capped at 100, got ${extremeRisk.score}`);
}

console.log("\nNO RISK FACTORS:");

const cleanRisk = riskEngine.calculate({
  agentId: "worker-clean",
  action: "read_task",
  trustScore: 100,
});

console.log(cleanRisk);

if (cleanRisk.factors.length !== 0) {
  throw new Error("Expected no risk factors");
}

console.log("\nRiskEngine tests passed.");
