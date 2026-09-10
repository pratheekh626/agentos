export interface Treasury {
  organizationId: string;

  balance: number;
  totalIssued: number;
  totalAllocated: number;

  updatedAt: string;
}

export class TreasuryService {
  private treasury: Treasury | null = null;

  initialize(
    organizationId: string,
    initialBalance = 0
  ): Treasury {
    if (this.treasury) {
      throw new Error(
        "Treasury has already been initialized"
      );
    }

    if (
      !Number.isFinite(initialBalance) ||
      initialBalance < 0
    ) {
      throw new Error(
        "Initial treasury balance cannot be negative"
      );
    }

    this.treasury = {
      organizationId,
      balance: initialBalance,
      totalIssued: initialBalance,
      totalAllocated: 0,
      updatedAt: new Date().toISOString(),
    };

    return this.treasury;
  }

  getTreasury(): Treasury {
    if (!this.treasury) {
      throw new Error(
        "Treasury has not been initialized"
      );
    }

    return this.treasury;
  }

  deposit(amount: number): Treasury {
    this.validateAmount(amount);

    const treasury = this.getTreasury();

    const updated: Treasury = {
      ...treasury,
      balance: treasury.balance + amount,
      totalIssued: treasury.totalIssued + amount,
      updatedAt: new Date().toISOString(),
    };

    this.treasury = updated;

    return updated;
  }

  allocate(amount: number): Treasury {
    this.validateAmount(amount);

    const treasury = this.getTreasury();

    if (amount > treasury.balance) {
      throw new Error(
        "Treasury does not have enough credits"
      );
    }

    const updated: Treasury = {
      ...treasury,
      balance: treasury.balance - amount,
      totalAllocated:
        treasury.totalAllocated + amount,
      updatedAt: new Date().toISOString(),
    };

    this.treasury = updated;

    return updated;
  }

  getAvailableBalance(): number {
    return this.getTreasury().balance;
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
