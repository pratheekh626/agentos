import { WalletService } from "./index";

const wallets = new WalletService();

const wallet = wallets.createWallet(
  "worker-001",
  1250,
  2000,
  500
);

console.log("INITIAL WALLET:");
console.log(wallet);

const afterDebit = wallets.debit(
  "worker-001",
  300
);

console.log("\nAFTER 300 CREDIT SPEND:");
console.log(afterDebit);

if (afterDebit.balance !== 950) {
  throw new Error(
    "Wallet balance was not updated correctly"
  );
}

if (afterDebit.spentToday !== 300) {
  throw new Error(
    "Daily spending was not updated correctly"
  );
}

try {
  wallets.debit(
    "worker-001",
    600
  );

  throw new Error(
    "Expected transaction limit to reject 600 credits"
  );
} catch (error) {
  console.log(
    "\nTRANSACTION LIMIT:",
    error instanceof Error
      ? error.message
      : error
  );
}

const frozen =
  wallets.freeze("worker-001");

console.log("\nFROZEN WALLET:");
console.log(frozen);

try {
  wallets.debit(
    "worker-001",
    100
  );

  throw new Error(
    "Expected frozen wallet to reject spending"
  );
} catch (error) {
  console.log(
    "\nFROZEN WALLET:",
    error instanceof Error
      ? error.message
      : error
  );
}

console.log(
  "\nWallet tests passed."
);
