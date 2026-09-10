export interface Wallet {
  agentId: string;

  balance: number;

  dailyLimit: number;
  spentToday: number;

  maxTransaction: number;

  frozen: boolean;

  updatedAt: string;
}

export class WalletService {
  private wallets = new Map<string, Wallet>();

  createWallet(
    agentId: string,
    initialBalance = 0,
    dailyLimit = 2000,
    maxTransaction = 500
  ): Wallet {
    if (this.wallets.has(agentId)) {
      throw new Error(`Wallet already exists: ${agentId}`);
    }

    if (initialBalance < 0) {
      throw new Error("Initial balance cannot be negative");
    }

    const wallet: Wallet = {
      agentId,
      balance: initialBalance,
      dailyLimit,
      spentToday: 0,
      maxTransaction,
      frozen: false,
      updatedAt: new Date().toISOString(),
    };

    this.wallets.set(agentId, wallet);

    return wallet;
  }

  getWallet(agentId: string): Wallet | undefined {
    return this.wallets.get(agentId);
  }

  credit(agentId: string, amount: number): Wallet {
    const wallet = this.requireWallet(agentId);

    this.validateAmount(amount);

    if (wallet.frozen) {
      throw new Error(`Wallet is frozen: ${agentId}`);
    }

    const updated: Wallet = {
      ...wallet,
      balance: wallet.balance + amount,
      updatedAt: new Date().toISOString(),
    };

    this.wallets.set(agentId, updated);

    return updated;
  }

  debit(agentId: string, amount: number): Wallet {
    const wallet = this.requireWallet(agentId);

    this.validateAmount(amount);

    if (wallet.frozen) {
      throw new Error(`Wallet is frozen: ${agentId}`);
    }

    if (amount > wallet.balance) {
      throw new Error(
        `Insufficient balance for ${agentId}`
      );
    }

    if (amount > wallet.maxTransaction) {
      throw new Error(
        `Transaction exceeds maximum limit for ${agentId}`
      );
    }

    if (
      wallet.spentToday + amount >
      wallet.dailyLimit
    ) {
      throw new Error(
        `Daily spending limit exceeded for ${agentId}`
      );
    }

    const updated: Wallet = {
      ...wallet,
      balance: wallet.balance - amount,
      spentToday: wallet.spentToday + amount,
      updatedAt: new Date().toISOString(),
    };

    this.wallets.set(agentId, updated);

    return updated;
  }

  freeze(agentId: string): Wallet {
    const wallet = this.requireWallet(agentId);

    const updated: Wallet = {
      ...wallet,
      frozen: true,
      updatedAt: new Date().toISOString(),
    };

    this.wallets.set(agentId, updated);

    return updated;
  }

  unfreeze(agentId: string): Wallet {
    const wallet = this.requireWallet(agentId);

    const updated: Wallet = {
      ...wallet,
      frozen: false,
      updatedAt: new Date().toISOString(),
    };

    this.wallets.set(agentId, updated);

    return updated;
  }

  resetDailySpend(agentId: string): Wallet {
    const wallet = this.requireWallet(agentId);

    const updated: Wallet = {
      ...wallet,
      spentToday: 0,
      updatedAt: new Date().toISOString(),
    };

    this.wallets.set(agentId, updated);

    return updated;
  }

  private requireWallet(agentId: string): Wallet {
    const wallet = this.wallets.get(agentId);

    if (!wallet) {
      throw new Error(
        `Wallet not found: ${agentId}`
      );
    }

    return wallet;
  }

  private validateAmount(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(
        "Amount must be a positive number"
      );
    }
  }
}
