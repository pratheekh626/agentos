import { BudgetService } from "./index";

const budgets = new BudgetService();

const budget =
  budgets.createBudget(
    "budget-worker-001",
    "worker-001",
    1000,
    600
  );

console.log("INITIAL BUDGET:");
console.log(budget);

const afterSpend =
  budgets.spend(
    "budget-worker-001",
    300
  );

console.log("\nAFTER SPENDING 300:");
console.log(afterSpend);

if (afterSpend.spent !== 300) {
  throw new Error(
    "Budget spending was not recorded correctly"
  );
}

if (
  budgets.getRemaining(
    "budget-worker-001"
  ) !== 700
) {
  throw new Error(
    "Remaining budget is incorrect"
  );
}

console.log(
  "\nREMAINING:",
  budgets.getRemaining(
    "budget-worker-001"
  )
);

console.log(
  "\nCAN SPEND 250:",
  budgets.canSpend(
    "budget-worker-001",
    250
  )
);

console.log(
  "CAN SPEND 400:",
  budgets.canSpend(
    "budget-worker-001",
    400
  )
);

try {
  budgets.spend(
    "budget-worker-001",
    400
  );

  throw new Error(
    "Expected daily budget limit to reject spending"
  );
} catch (error) {
  console.log(
    "\nBUDGET LIMIT:",
    error instanceof Error
      ? error.message
      : error
  );
}

const frozen =
  budgets.freeze(
    "budget-worker-001"
  );

console.log(
  "\nFROZEN BUDGET:"
);
console.log(frozen);

if (
  budgets.canSpend(
    "budget-worker-001",
    100
  )
) {
  throw new Error(
    "Frozen budget should reject spending"
  );
}

console.log(
  "\nBudget tests passed."
);
