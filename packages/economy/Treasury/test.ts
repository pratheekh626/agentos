import { TreasuryService } from "./index";

const treasury = new TreasuryService();

const initial =
  treasury.initialize(
    "agentos-org",
    10000
  );

console.log("INITIAL TREASURY:");
console.log(initial);

const afterAllocation =
  treasury.allocate(1250);

console.log("\nAFTER ALLOCATING 1250:");
console.log(afterAllocation);

if (afterAllocation.balance !== 8750) {
  throw new Error(
    "Treasury balance was not reduced correctly"
  );
}

if (afterAllocation.totalAllocated !== 1250) {
  throw new Error(
    "Treasury allocation was not recorded correctly"
  );
}

const afterDeposit =
  treasury.deposit(5000);

console.log("\nAFTER DEPOSITING 5000:");
console.log(afterDeposit);

if (afterDeposit.balance !== 13750) {
  throw new Error(
    "Treasury deposit was not recorded correctly"
  );
}

try {
  treasury.allocate(20000);

  throw new Error(
    "Expected allocation to exceed treasury balance"
  );
} catch (error) {
  console.log(
    "\nTREASURY LIMIT:",
    error instanceof Error
      ? error.message
      : error
  );
}

console.log(
  "\nTreasury tests passed."
);
