// globally used types
type Logger = import("pino").Logger

type Currency = "USD" | "BTC"

type Primitive = string | boolean | number

// configs & constructors
// TODO: clean up this section when "constructor typing" work is
//       being done

type LimitConstants = {
  oldEnoughForWithdrawalHours: number
  oldEnoughForWithdrawalMicroseconds: number
}

type UserLimitsArgs = { level: number }

interface IUserLimits {
  onUsLimit: number
  withdrawalLimit: number
}

interface ITransactionLimits extends IUserLimits {
  oldEnoughForWithdrawalLimit: number
}

type UserWalletConfig = {
  dustThreshold: number
  limits: ITransactionLimits
  name: string
}

type WalletConstructorArgs = {
  user: UserType
  logger: Logger
}

type UserWalletConstructorArgs = WalletConstructorArgs & {
  config: UserWalletConfig
}

// Currently unused types

interface IAddBTCInvoiceRequest {
  value: number | undefined
  memo?: string | undefined
  selfGenerated?: boolean
}

interface IAddUSDInvoiceRequest {
  value: number
  memo: string | undefined
}

type IAddInvoiceResponse = {
  request: string
}

type Levels = number[]

type IPayInvoice = {
  invoice: string
}

type Side = "buy" | "sell"

interface IQuoteRequest {
  side: Side
  satAmount?: number // sell
  invoice?: string // buy
}
