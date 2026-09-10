export type TransactionType =
  | "credit"
  | "debit";

export type TransactionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "completed"
  | "failed";

export interface Transaction {
  id: string;

  agentId: string;

  type: TransactionType;

  amount: number;

  status: TransactionStatus;

  reason: string;

  taskId: string | null;

  createdAt: string;

  completedAt: string | null;
}

export class TransactionService {
  private transactions = new Map<
    string,
    Transaction
  >();

  create(
    id: string,
    agentId: string,
    type: TransactionType,
    amount: number,
    reason: string,
    taskId: string | null = null
  ): Transaction {
    if (this.transactions.has(id)) {
      throw new Error(
        `Transaction already exists: ${id}`
      );
    }

    this.validateAmount(amount);

    const transaction: Transaction = {
      id,
      agentId,
      type,
      amount,
      status: "pending",
      reason,
      taskId,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    this.transactions.set(id, transaction);

    return transaction;
  }

  approve(
    transactionId: string
  ): Transaction {
    const transaction =
      this.requireTransaction(
        transactionId
      );

    this.assertPending(transaction);

    const updated: Transaction = {
      ...transaction,
      status: "approved",
    };

    this.transactions.set(
      transactionId,
      updated
    );

    return updated;
  }

  reject(
    transactionId: string,
    reason?: string
  ): Transaction {
    const transaction =
      this.requireTransaction(
        transactionId
      );

    this.assertPending(transaction);

    const updated: Transaction = {
      ...transaction,
      status: "rejected",
      reason:
        reason ?? transaction.reason,
      completedAt:
        new Date().toISOString(),
    };

    this.transactions.set(
      transactionId,
      updated
    );

    return updated;
  }

  complete(
    transactionId: string
  ): Transaction {
    const transaction =
      this.requireTransaction(
        transactionId
      );

    if (
      transaction.status !== "approved"
    ) {
      throw new Error(
        "Only approved transactions can be completed"
      );
    }

    const updated: Transaction = {
      ...transaction,
      status: "completed",
      completedAt:
        new Date().toISOString(),
    };

    this.transactions.set(
      transactionId,
      updated
    );

    return updated;
  }

  fail(
    transactionId: string,
    reason: string
  ): Transaction {
    const transaction =
      this.requireTransaction(
        transactionId
      );

    if (
      transaction.status === "completed"
    ) {
      throw new Error(
        "Completed transaction cannot fail"
      );
    }

    const updated: Transaction = {
      ...transaction,
      status: "failed",
      reason,
      completedAt:
        new Date().toISOString(),
    };

    this.transactions.set(
      transactionId,
      updated
    );

    return updated;
  }

  get(
    transactionId: string
  ): Transaction | undefined {
    return this.transactions.get(
      transactionId
    );
  }

  getByAgent(
    agentId: string
  ): Transaction[] {
    return Array.from(
      this.transactions.values()
    ).filter(
      (transaction) =>
        transaction.agentId === agentId
    );
  }

  getByTask(
    taskId: string
  ): Transaction[] {
    return Array.from(
      this.transactions.values()
    ).filter(
      (transaction) =>
        transaction.taskId === taskId
    );
  }

  getAll(): Transaction[] {
    return Array.from(
      this.transactions.values()
    );
  }

  private requireTransaction(
    transactionId: string
  ): Transaction {
    const transaction =
      this.transactions.get(
        transactionId
      );

    if (!transaction) {
      throw new Error(
        `Transaction not found: ${transactionId}`
      );
    }

    return transaction;
  }

  private assertPending(
    transaction: Transaction
  ): void {
    if (
      transaction.status !== "pending"
    ) {
      throw new Error(
        `Transaction is already ${transaction.status}`
      );
    }
  }

  private validateAmount(
    amount: number
  ): void {
    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      throw new Error(
        "Transaction amount must be positive"
      );
    }
  }
}
