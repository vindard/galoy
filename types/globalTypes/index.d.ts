type Logger = import("pino").Logger

type SpecterWalletConfig = {
  lndHoldingBase: number
  ratioTargetDeposit: number
  ratioTargetWithdraw: number
  minOnchain: number
  onchainWallet: string
}
