import { AnomalyDetectionService } from "./index";

const detector = new AnomalyDetectionService();

console.log("\nNORMAL ACTIVITY:");

const normal = detector.analyze({
  agentId: "worker-frontend",
  recentActions: 10,
  failedActions: 0,
  deniedActions: 0,
  spendingToday: 100,
  averageDailySpending: 100,
  delegationsToday: 2,
  averageDailyDelegations: 2,
  activityPerHour: 5,
  normalActivityPerHour: 5,
});

console.log(normal);

if (normal.detected) {
  throw new Error("Expected normal activity");
}

console.log("\nREPEATED FAILURES:");

const failures = detector.analyze({
  agentId: "worker-backend",
  recentActions: 15,
  failedActions: 4,
  deniedActions: 0,
  spendingToday: 100,
  averageDailySpending: 100,
  delegationsToday: 2,
  averageDailyDelegations: 2,
  activityPerHour: 5,
  normalActivityPerHour: 5,
});

console.log(failures);

if (!failures.detected) {
  throw new Error("Expected repeated failure anomaly");
}

console.log("\nSPENDING SPIKE:");

const spending = detector.analyze({
  agentId: "worker-payments",
  recentActions: 20,
  failedActions: 0,
  deniedActions: 0,
  spendingToday: 350,
  averageDailySpending: 100,
  delegationsToday: 2,
  averageDailyDelegations: 2,
  activityPerHour: 5,
  normalActivityPerHour: 5,
});

console.log(spending);

if (!spending.detected) {
  throw new Error("Expected spending anomaly");
}

console.log("\nEXCESSIVE DELEGATION:");

const delegation = detector.analyze({
  agentId: "manager-engineering",
  recentActions: 20,
  failedActions: 0,
  deniedActions: 0,
  spendingToday: 100,
  averageDailySpending: 100,
  delegationsToday: 6,
  averageDailyDelegations: 2,
  activityPerHour: 5,
  normalActivityPerHour: 5,
});

console.log(delegation);

if (!delegation.detected) {
  throw new Error("Expected delegation anomaly");
}

console.log("\nREPEATED DENIALS:");

const denials = detector.analyze({
  agentId: "worker-security",
  recentActions: 20,
  failedActions: 0,
  deniedActions: 5,
  spendingToday: 100,
  averageDailySpending: 100,
  delegationsToday: 2,
  averageDailyDelegations: 2,
  activityPerHour: 5,
  normalActivityPerHour: 5,
});

console.log(denials);

if (!denials.detected) {
  throw new Error("Expected denial anomaly");
}

console.log("\nABNORMAL ACTIVITY:");

const activity = detector.analyze({
  agentId: "worker-suspicious",
  recentActions: 100,
  failedActions: 0,
  deniedActions: 0,
  spendingToday: 100,
  averageDailySpending: 100,
  delegationsToday: 2,
  averageDailyDelegations: 2,
  activityPerHour: 20,
  normalActivityPerHour: 5,
});

console.log(activity);

if (!activity.detected) {
  throw new Error("Expected abnormal activity anomaly");
}

console.log("\nMULTIPLE ANOMALIES:");

const multiple = detector.analyze({
  agentId: "worker-risky",
  recentActions: 100,
  failedActions: 5,
  deniedActions: 5,
  spendingToday: 400,
  averageDailySpending: 100,
  delegationsToday: 6,
  averageDailyDelegations: 2,
  activityPerHour: 20,
  normalActivityPerHour: 5,
});

console.log(multiple);

if (!multiple.detected) {
  throw new Error("Expected multiple anomalies");
}

if (multiple.score !== 100) {
  throw new Error(`Expected score to be capped at 100, got ${multiple.score}`);
}

console.log("\nAnomalyDetection tests passed.");
