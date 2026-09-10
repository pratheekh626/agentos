import { QAService } from "./index";

const qa = new QAService();

const productionCheck = qa.create(
  "qa-001",
  "task-production",
  [
    "Unit tests",
    "Integration tests",
    "Security checks",
    "Build validation",
  ]
);

console.log("\nCREATED QA CHECK:");
console.log(productionCheck);

const passed = qa.pass(
  "qa-001",
  98,
  "qa-agent-001"
);

console.log("\nPASSED QA:");
console.log(passed);

if (
  passed.status !== "passed" ||
  passed.score !== 98 ||
  passed.checkedBy !== "qa-agent-001"
) {
  throw new Error("Expected QA check to pass");
}

const securityCheck = qa.create(
  "qa-002",
  "task-security",
  [
    "Dependency scan",
    "API security",
  ]
);

console.log("\nCREATED SECURITY QA:");
console.log(securityCheck);

const failed = qa.fail(
  "qa-002",
  35,
  [
    "Outdated dependency detected",
    "API endpoint missing authorization",
  ],
  "security-agent-001"
);

console.log("\nFAILED QA:");
console.log(failed);

if (
  failed.status !== "failed" ||
  failed.score !== 35 ||
  failed.issues.length !== 2
) {
  throw new Error("Expected QA check to fail with issues");
}

try {
  qa.pass(
    "qa-001",
    100,
    "qa-agent-002"
  );

  throw new Error(
    "Expected resolved QA check to reject"
  );
} catch (error) {
  console.log(
    "\nDOUBLE RESOLUTION CHECK:",
    error instanceof Error
      ? error.message
      : error
  );
}

console.log("\nQA tests passed.");

const eventQA = new QAService();
const passedEvents: import("./index").QACheck[] = [];
const failedEvents: import("./index").QACheck[] = [];

eventQA.events.on("qa.passed", (check) => {
  passedEvents.push(check);
});

eventQA.events.on("qa.failed", (check) => {
  failedEvents.push(check);
});

const eventPassed = eventQA.create(
  "qa-pass",
  "task-qa-pass",
  ["Build validation"]
);

eventQA.pass(
  eventPassed.id,
  95,
  "qa-agent-events"
);

if (
  passedEvents.length !== 1 ||
  passedEvents[0].id !== "qa-pass"
) {
  throw new Error("Expected qa.passed event");
}

const eventFailed = eventQA.create(
  "qa-fail",
  "task-qa-fail",
  ["Security validation"]
);

eventQA.fail(
  eventFailed.id,
  20,
  ["Security check failed"],
  "qa-agent-events"
);

if (
  failedEvents.length !== 1 ||
  failedEvents[0].id !== "qa-fail"
) {
  throw new Error("Expected qa.failed event");
}

console.log("QA event tests passed.");
