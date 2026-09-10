import { IdentityService } from "./index";

const identityService = new IdentityService();

const boss = identityService.createIdentity({
  agentId: "boss-001",
  role: "boss",
});

const manager = identityService.createIdentity({
  agentId: "manager-001",
  role: "manager",
});

const worker = identityService.createIdentity({
  agentId: "worker-001",
  role: "worker",
});

console.log("\nCREATED IDENTITIES:");
console.log(identityService.getAll());

if (!boss.fingerprint) {
  throw new Error("Boss identity fingerprint missing");
}

if (!manager.fingerprint) {
  throw new Error("Manager identity fingerprint missing");
}

if (!worker.fingerprint) {
  throw new Error("Worker identity fingerprint missing");
}

if (!identityService.isActive("worker-001")) {
  throw new Error("Worker identity should be active");
}

if (
  !identityService.verifyIdentity(
    "worker-001",
    worker.fingerprint
  )
) {
  throw new Error("Valid worker identity was rejected");
}

console.log("\nIDENTITY VERIFICATION: PASSED");

if (
  identityService.verifyIdentity(
    "worker-001",
    "invalid-fingerprint"
  )
) {
  throw new Error("Invalid fingerprint was accepted");
}

console.log("INVALID FINGERPRINT CHECK: PASSED");

const revoked = identityService.revokeIdentity("worker-001");

console.log("\nREVOKED IDENTITY:");
console.log(revoked);

if (identityService.isActive("worker-001")) {
  throw new Error("Revoked identity is still active");
}

if (
  identityService.verifyIdentity(
    "worker-001",
    worker.fingerprint
  )
) {
  throw new Error("Revoked identity was accepted");
}

console.log("REVOCATION CHECK: PASSED");

try {
  identityService.createIdentity({
    agentId: "boss-001",
    role: "boss",
  });

  throw new Error("Duplicate identity was accepted");
} catch (error) {
  console.log(
    "\nDUPLICATE IDENTITY CHECK:",
    error instanceof Error ? error.message : error
  );
}

try {
  identityService.revokeIdentity("worker-001");

  throw new Error("Already revoked identity was accepted");
} catch (error) {
  console.log(
    "DOUBLE REVOCATION CHECK:",
    error instanceof Error ? error.message : error
  );
}

console.log("\nIdentity tests passed.");
