export type Side = "buy" | "sell"
export type Currency = "USD" | "BTC"


// Lightning

export type IAddInvoiceRequest = {
    value: number,
    memo: string
}

export type IAddInvoiceResponse = {
    request: string
}

export type TransactionType = "payment" | "inflight-payment" | 
    "paid-invoice" | "unconfirmed-invoice" | "earn" | "onchain_receipt"

export interface ILightningTransaction {
    amount: number
    description: string
    created_at: Date
    hash?: string
    destination?: string
    type: TransactionType
}

export interface IPaymentRequest {
    pubkey: string;
    amount: number;
    message?: string;
    hash?: string;
    routes?: object[]; // FIXME
}

export type IPayInvoice = {
    invoice: string
}

export interface IQuoteRequest {
    side: Side, 
    satAmount?: number, // sell
    invoice?: string,   // buy
}

// onboarding
export const OnboardingEarn = {
    walletDownloaded: 1,
    walletActivated: 1,
    whatIsBitcoin: 1,
    sat: 2,
    whereBitcoinExist: 5,
    whoControlsBitcoin: 5,
    copyBitcoin: 5,
    moneyImportantGovernement: 10,
    moneyIsImportant: 10,
    whyStonesShellGold: 10,
    moneyEvolution: 10,
    coincidenceOfWants: 10,
    moneySocialAggrement: 10,

    WhatIsFiat: 10,
    whyCareAboutFiatMoney: 10,
    GovernementCanPrintMoney: 10,
    FiatLosesValueOverTime: 10,
    OtherIssues: 10, 
    LimitedSupply: 20,
    Decentralized: 20,
    NoCounterfeitMoney: 20,
    HighlyDivisible: 20,
    securePartOne: 20,
    securePartTwo: 20,


    freeMoney: 50,
    custody: 100,
    digitalKeys: 100,
    backupWallet: 500,
    fiatMoney: 100,
    bitcoinUnique: 100,
    moneySupply: 100,
    newBitcoin: 100,
    creator: 100,
    volatility: 50000,
    activateNotifications: 500,
    phoneVerification: 2000,
    firstLnPayment: 1000,
    transaction: 500,
    paymentProcessing: 500,
    decentralization: 500,
    privacy: 500,
    mining: 500,
    inviteAFriend: 5000,
    bankOnboarded: 10000,
    buyFirstSats: 10000,
    debitCardActivation: 10000,
    firstCardSpending: 10000,
    firstSurvey: 10000,
    activateDirectDeposit: 10000,
    doubleSpend: 500,
    exchangeHack: 500,
    energy: 500,
    difficultyAdjustment: 500,
    dollarCostAveraging: 500,
    scalability: 500,
    lightning: 500,
    moneyLaundering: 500,
    tweet: 1000,
}