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
