export interface Budget {
  id: string;

  ownerId: string;

  allocated: number;
  spent: number;

  dailyLimit: number;

  active: boolean;

  updatedAt: string;
}

export class BudgetService {
  private budgets = new Map<string, Budget>();

  createBudget(
    id: string,
    ownerId: string,
    allocated: number,
    dailyLimit: number
  ): Budget {
    if (this.budgets.has(id)) {
      throw new Error(
        `Budget already exists: ${id}`
      );
    }

    if (
      !Number.isFinite(allocated) ||
      allocated < 0
    ) {
      throw new Error(
        "Allocated budget cannot be negative"
      );
    }

    if (
      !Number.isFinite(dailyLimit) ||
      dailyLimit < 0
    ) {
      throw new Error(
        "Daily limit cannot be negative"
      );
    }

    const budget: Budget = {
      id,
      ownerId,
      allocated,
      spent: 0,
      dailyLimit,
      active: true,
      updatedAt: new Date().toISOString(),
    };

    this.budgets.set(id, budget);

    return budget;
  }

  getBudget(id: string): Budget | undefined {
    return this.budgets.get(id);
  }

  canSpend(
    id: string,
    amount: number
  ): boolean {
    const budget = this.requireBudget(id);

    this.validateAmount(amount);

    if (!budget.active) {
      return false;
    }

    if (
      budget.spent + amount >
      budget.allocated
    ) {
      return false;
    }

    if (
      budget.spent + amount >
      budget.dailyLimit
    ) {
      return false;
    }

    return true;
  }

  spend(
    id: string,
    amount: number
  ): Budget {
    const budget = this.requireBudget(id);

    this.validateAmount(amount);

    if (!budget.active) {
      throw new Error(
        `Budget is inactive: ${id}`
      );
    }

    if (
      budget.spent + amount >
      budget.allocated
    ) {
      throw new Error(
        `Budget allocation exceeded: ${id}`
      );
    }

    if (
      budget.spent + amount >
      budget.dailyLimit
    ) {
      throw new Error(
        `Budget daily limit exceeded: ${id}`
      );
    }

    const updated: Budget = {
      ...budget,
      spent: budget.spent + amount,
      updatedAt: new Date().toISOString(),
    };

    this.budgets.set(id, updated);

    return updated;
  }

  addAllocation(
    id: string,
    amount: number
  ): Budget {
    const budget = this.requireBudget(id);

    this.validateAmount(amount);

    const updated: Budget = {
      ...budget,
      allocated:
        budget.allocated + amount,
      updatedAt: new Date().toISOString(),
    };

    this.budgets.set(id, updated);

    return updated;
  }

  freeze(id: string): Budget {
    const budget = this.requireBudget(id);

    const updated: Budget = {
      ...budget,
      active: false,
      updatedAt: new Date().toISOString(),
    };

    this.budgets.set(id, updated);

    return updated;
  }

  activate(id: string): Budget {
    const budget = this.requireBudget(id);

    const updated: Budget = {
      ...budget,
      active: true,
      updatedAt: new Date().toISOString(),
    };

    this.budgets.set(id, updated);

    return updated;
  }

  resetDailySpend(id: string): Budget {
    const budget = this.requireBudget(id);

    const updated: Budget = {
      ...budget,
      spent: 0,
      updatedAt: new Date().toISOString(),
    };

    this.budgets.set(id, updated);

    return updated;
  }

  getRemaining(id: string): number {
    const budget = this.requireBudget(id);

    return Math.max(
      0,
      budget.allocated - budget.spent
    );
  }

  private requireBudget(id: string): Budget {
    const budget = this.budgets.get(id);

    if (!budget) {
      throw new Error(
        `Budget not found: ${id}`
      );
    }

    return budget;
  }

  private validateAmount(amount: number): void {
    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      throw new Error(
        "Amount must be a positive number"
      );
    }
  }
}
