import fs from "fs"
import yaml from "js-yaml"
import _ from "lodash"
import { baseLogger } from "./logger"

const defaultContent = fs.readFileSync("./default.yaml", "utf8")
export const defaultConfig = yaml.load(defaultContent)

const MS_IN_HOUR = 60 * 60 * 1000

let customContent, customConfig

try {
  customContent = fs.readFileSync("/var/yaml/custom.yaml", "utf8")
  customConfig = yaml.load(customContent)
} catch (err) {
  if (process.env.NETWORK !== "regtest") {
    baseLogger.info({ err }, "no custom.yaml available. loading default values")
  }
}

export const yamlConfig = _.merge(defaultConfig, customConfig)

const limitConstants = {
  oldEnoughForWithdrawalHours: yamlConfig.limits.oldEnoughForWithdrawal / MS_IN_HOUR,
  oldEnoughForWithdrawalMicroseconds: yamlConfig.limits.oldEnoughForWithdrawal,
}

export const selectUserLimits = ({ level }: { level: number }): IUserLimits => {
  const config = yamlConfig.limits
  return {
    onUsLimit: config.onUs.level[level],
    withdrawalLimit: config.withdrawal.level[level],
  }
}

export const getUserWalletConfig = (user): UserWalletConfig => {
  const userLimits = selectUserLimits({ level: user.level })

  return {
    name: yamlConfig.name,
    dustThreshold: yamlConfig.onChainWallet.dustThreshold,
    limits: {
      oldEnoughForWithdrawalLimit: limitConstants.oldEnoughForWithdrawalHours,
      ...userLimits,
    },
  }
}

export const getSpecterWalletConfig = (): SpecterWalletConfig => {
  const config = yamlConfig.rebalancing
  return {
    lndHoldingBase: config.lndHoldingBase,
    ratioTargetDeposit: config.ratioTargetDeposit,
    ratioTargetWithdraw: config.ratioTargetWithdraw,
    minOnchain: config.minOnchain,
    onchainWallet: config.onchainWallet ?? "specter",
  }
}

export const levels: Levels = [1, 2]

// onboarding
export const onboardingEarn = {
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
