type PaymentInitiationMethod =
  typeof import("./tx-methods").PaymentInitiationMethod[keyof typeof import("./tx-methods").PaymentInitiationMethod]
type SettlementMethod =
  typeof import("./tx-methods").SettlementMethod[keyof typeof import("./tx-methods").SettlementMethod]
type TxStatus =
  typeof import("./tx-status").TxStatus[keyof typeof import("./tx-status").TxStatus]

type Deprecated = {
  readonly description: string
  readonly type: LedgerTransactionType
  readonly usd: number
  readonly feeUsd: number
}

type BaseWalletTransaction = {
  readonly id: LedgerTransactionId | TxId
  readonly initiationVia: PaymentInitiationMethod
  readonly settlementVia: SettlementMethod
  readonly settlementAmount: Satoshis
  readonly settlementFee: Satoshis
  readonly status: TxStatus
  readonly createdAt: Date

  readonly deprecated: Deprecated
}

type WalletNameTransaction = BaseWalletTransaction & {
  readonly initiationVia: "walletname"
  readonly settlementVia: "intraledger"
  readonly recipientId: WalletName
}

type WalletOnChainTransaction = BaseWalletTransaction & {
  readonly initiationVia: "onchain"
  readonly settlementVia: "onchain" | "intraledger"
  readonly recipientId: WalletName | null
  readonly addresses: OnChainAddress[]
}

type WalletLnTransaction = BaseWalletTransaction & {
  readonly initiationVia: "lightning"
  readonly settlementVia: "lightning" | "intraledger"
  readonly recipientId: WalletName | null
  readonly paymentHash: PaymentHash
}

type WalletTransaction =
  | WalletNameTransaction
  | WalletOnChainTransaction
  | WalletLnTransaction

type ConfirmedTransactionHistory = {
  readonly transactions: WalletTransaction[]
  addPendingIncoming(
    pendingIncoming: SubmittedTransaction[],
    addresses: OnChainAddress[],
    usdPerSat: UsdPerSat,
  ): WalletTransactionHistoryWithPending
}

type WalletTransactionHistoryWithPending = {
  readonly transactions: WalletTransaction[]
}

declare const depositFeeRatioSymbol: unique symbol
type DepositFeeRatio = number & { [depositFeeRatioSymbol]: never }

declare const withdrawFeeSymbol: unique symbol
type WithdrawFee = number & { [withdrawFeeSymbol]: never }

type Wallet = {
  readonly id: WalletId
  readonly depositFeeRatio: DepositFeeRatio
  readonly withdrawFee: WithdrawFee
  readonly walletName: WalletName | null
  readonly onChainAddressIdentifiers: OnChainAddressIdentifier[]
  onChainAddresses(): OnChainAddress[]
}

interface IWalletsRepository {
  findById(walletId: WalletId): Promise<Wallet | RepositoryError>
  findByWalletName(walletName: WalletName): Promise<Wallet | RepositoryError>
  findByAddress(address: OnChainAddress): Promise<Wallet | RepositoryError>
  listByAddresses(addresses: string[]): Promise<Wallet[] | RepositoryError>
}

type onChainDepositFeeArgs = {
  amount: Satoshis
  ratio: DepositFeeRatio
}

type DepositFeeCalculator = {
  onChainDepositFee({ amount, ratio }: onChainDepositFeeArgs): Satoshis
  lnDepositFee(): Satoshis
}

type OnChainWithdrawalFeeArgs = {
  onChainFee: Satoshis
  walletFee: Satoshis
}

type WithdrawalFeeCalculator = {
  onChainWithdrawalFee({ onChainFee, walletFee }: OnChainWithdrawalFeeArgs): Satoshis
  onChainIntraLedgerFee(): Satoshis
}
