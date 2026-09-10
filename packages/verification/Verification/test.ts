import {
  EvidenceService,
} from "../Evidence";

import {
  VerificationService,
} from "./index";

const evidenceService =
  new EvidenceService();

const verification =
  new VerificationService();

const evidence =
  evidenceService.create(
    "evidence-001",
    "task-production",
    "worker-001",
    "test_result",
    "Frontend tests",
    "All frontend tests passed.",
    "test-run-001"
  );

const created =
  verification.create(
    "verification-001",
    "task-production",
    [evidence]
  );

console.log(
  "CREATED VERIFICATION:"
);

console.log(created);

if (
  created.status !== "pending" ||
  created.evidenceIds.length !== 1
) {
  throw new Error(
    "Verification creation failed"
  );
}

const passed =
  verification.pass(
    "verification-001",
    96,
    "Evidence confirms the task passed verification.",
    "qa-agent-001"
  );

console.log(
  "\nPASSED VERIFICATION:"
);

console.log(passed);

if (
  passed.status !== "passed" ||
  passed.score !== 96 ||
  passed.verifiedBy !== "qa-agent-001"
) {
  throw new Error(
    "Verification pass failed"
  );
}

const failedEvidence =
  evidenceService.create(
    "evidence-002",
    "task-security",
    "worker-002",
    "log",
    "Security log",
    "Suspicious operation detected.",
    "security-log-001"
  );

const failedVerification =
  verification.create(
    "verification-002",
    "task-security",
    [failedEvidence]
  );

const failed =
  verification.fail(
    "verification-002",
    25,
    "Security validation failed.",
    "security-agent-001"
  );

console.log(
  "\nFAILED VERIFICATION:"
);

console.log(failed);

if (
  failed.status !== "failed" ||
  failed.score !== 25
) {
  throw new Error(
    "Verification failure handling failed"
  );
}

try {
  verification.pass(
    "verification-001",
    100,
    "Attempting to resolve twice.",
    "qa-agent-002"
  );

  throw new Error(
    "Expected resolved verification to reject"
  );
} catch (error) {
  console.log(
    "\nDOUBLE RESOLUTION CHECK:",
    error instanceof Error
      ? error.message
      : error
  );
}

console.log(
  "\nVerification tests passed."
);

const eventVerification =
  new VerificationService();

let passedEventId: string | null = null;
let failedEventId: string | null = null;

eventVerification.events.on(
  "verification.passed",
  (check) => {
    passedEventId = check.id;
  }
);

eventVerification.events.on(
  "verification.failed",
  (check) => {
    failedEventId = check.id;
  }
);

const passedCheck =
  eventVerification.create(
    "verification-event-pass",
    "task-event-pass",
    [
      {
        id: "evidence-event-pass",
        taskId: "task-event-pass",
        agentId: "worker-event",
        type: "test_result",
        title: "Passing evidence",
        description: "Verification event test",
        reference: "test://pass",
        createdAt:
          "2026-09-11T00:00:00.000Z",
      },
    ]
  );

eventVerification.pass(
  passedCheck.id,
  95,
  "Verification passed",
  "tester-event"
);

if (passedEventId !== passedCheck.id) {
  throw new Error(
    "Expected verification.passed event"
  );
}

const failedCheck =
  eventVerification.create(
    "verification-event-fail",
    "task-event-fail",
    [
      {
        id: "evidence-event-fail",
        taskId: "task-event-fail",
        agentId: "worker-event",
        type: "test_result",
        title: "Failing evidence",
        description: "Verification event test",
        reference: "test://fail",
        createdAt:
          "2026-09-11T00:01:00.000Z",
      },
    ]
  );

eventVerification.fail(
  failedCheck.id,
  25,
  "Verification failed",
  "tester-event"
);

if (failedEventId !== failedCheck.id) {
  throw new Error(
    "Expected verification.failed event"
  );
}

console.log(
  "Verification event tests passed"
);
