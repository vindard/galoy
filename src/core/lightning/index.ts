import assert from "assert"
import { payViaPaymentDetails, payViaRoutes } from "lightning"
import lnService from "ln-service"
import { verifyToken } from "node-2fa"

import * as Wallets from "@app/wallets"
import { TIMEOUT_PAYMENT } from "@services/lnd/auth"
import { WalletInvoicesRepository } from "@services/mongoose"
import { getActiveLnd, getLndFromPubkey, validate } from "@services/lnd/utils"
import { ledger } from "@services/mongodb"
import { redis } from "@services/redis"
import { User } from "@services/mongoose/schema"

import {
  DbError,
  InsufficientBalanceError,
  LightningPaymentError,
  NewAccountWithdrawalError,
  NotFoundError,
  RouteFindingError,
  SelfPaymentError,
  TransactionRestrictedError,
  TwoFAError,
} from "../error"
import { lockExtendOrThrow, redlock } from "../lock"
import { transactionNotification } from "@services/notifications/payment"
import { UserWallet } from "../user-wallet"
import { addContact, isInvoiceAlreadyPaidError, timeout } from "../utils"
import { lnPaymentStatusEvent } from "@config/app"
import pubsub from "@services/pubsub"
import { LndService } from "@services/lnd"

export type ITxType =
  | "invoice"
  | "payment"
  | "onchain_receipt"
  | "onchain_payment"
  | "on_us"
export type payInvoiceResult = "success" | "failed" | "pending" | "already_paid"

export const LightningMixin = (superclass) =>
  class extends superclass {
    readonly config: UserWalletConfig
    readonly invoices: IWalletInvoicesRepository

    constructor(args: UserWalletConstructorArgs) {
      super(args)
      this.config = args.config
      this.invoices = WalletInvoicesRepository()
    }

    async updatePending(lock) {
      const [, updatePaymentsResult] = await Promise.all([
        Wallets.updatePendingInvoices({
          walletId: this.user.id as WalletId,
          lock,
          logger: this.logger,
        }),
        Wallets.updatePendingPayments({
          walletId: this.user.id as WalletId,
          lock,
          logger: this.logger,
        }),
      ])
      if (updatePaymentsResult instanceof Error) throw updatePaymentsResult
    }

    async getLightningFee(params: IFeeRequest): Promise<number> {
      // TODO:
      // we should also log the fact we have started the query
      // if (await redis.get(JSON.stringify(params))) {
      //   return
      // }
      //
      // OR: add a lock

      // TODO: do a balance check, so that we don't probe needlessly if the user doesn't have the
      // probably make sense to used a cached balance here.

      const {
        mtokens,
        max_fee,
        destination,
        id,
        routeHint,
        cltv_delta,
        features,
        payment,
      } = await validate({ params, logger: this.logger })

      const lightningLogger = this.logger.child({
        topic: "fee_estimation",
        protocol: "lightning",
        params,
        decoded: {
          mtokens,
          max_fee,
          destination,
          id,
          routeHint,
          cltv_delta,
          features,
          payment,
        },
      })

      // safety check
      // this should not happen as this check is done within RN

      // TODO: mobile side should also haev a list of array instead of a single node
      const lndService = LndService()
      if (lndService instanceof Error) throw lndService
      if (lndService.isLocal(destination)) {
        lightningLogger.warn("probe for self")
        return 0
      }

      const { lnd, pubkey } = getActiveLnd()

      const key = JSON.stringify({ id, mtokens })

      const cacheProbe = await redis.get(key)
      if (cacheProbe) {
        lightningLogger.info("route result in cache")
        return JSON.parse(cacheProbe).fee
      }

      let route

      try {
        ;({ route } = await lnService.probeForRoute({
          lnd,
          destination,
          mtokens,
          routes: routeHint,
          cltv_delta,
          features,
          max_fee,
          payment,
          total_mtokens: payment ? mtokens : undefined,
        }))
      } catch (err) {
        throw new RouteFindingError(undefined, {
          logger: lightningLogger,
          probingSuccess: false,
          success: false,
        })
      }

      if (!route) {
        // TODO: check if the error is irrecoverable or not.
        throw new RouteFindingError(undefined, {
          logger: lightningLogger,
          probingSuccess: false,
          success: false,
        })
      }

      const value = JSON.stringify({ ...route, pubkey })
      await redis.set(key, value, "EX", 60 * 5) // expires after 5 minutes

      lightningLogger.info(
        { redis: { key, value }, probingSuccess: true, success: true },
        "successfully found a route",
      )
      return route.fee
    }

    async pay(params: IPaymentRequest): Promise<payInvoiceResult | Error> {
      let lightningLogger = this.logger.child({
        topic: "payment",
        protocol: "lightning",
        transactionType: "payment",
      })

      const {
        tokens,
        mtokens,
        username: input_username,
        destination,
        isPushPayment,
        id,
        routeHint,
        memoInvoice,
        payment,
        cltv_delta,
        features,
        max_fee,
      } = await validate({ params, logger: lightningLogger })
      const { memo: memoPayer, twoFAToken } = params

      // not including message because it contains the preimage and we don't want to log this
      lightningLogger = lightningLogger.child({
        decoded: {
          tokens,
          destination,
          isPushPayment,
          id,
          routeHint,
          memoInvoice,
          memoPayer,
          payment,
          cltv_delta,
          features,
        },
        params,
      })

      const remainingTwoFALimit = await this.user.remainingTwoFALimit()

      if (this.user.twoFA.secret && remainingTwoFALimit < tokens) {
        if (!twoFAToken) {
          throw new TwoFAError("Need a 2FA code to proceed with the payment", {
            logger: lightningLogger,
          })
        }

        if (!verifyToken(this.user.twoFA.secret, twoFAToken)) {
          throw new TwoFAError(undefined, { logger: lightningLogger })
        }
      }

      let fee
      let route
      let paymentPromise
      let feeKnownInAdvance

      return redlock({ path: this.user._id, logger: lightningLogger }, async (lock) => {
        const balanceSats = await Wallets.getBalanceForWallet({
          walletId: this.user.id,
          logger: lightningLogger,
        })
        if (balanceSats instanceof Error) throw balanceSats

        // On us transaction
        const lndService = LndService()
        if (lndService instanceof Error) throw lndService
        if (lndService.isLocal(destination) || isPushPayment) {
          const lightningLoggerOnUs = lightningLogger.child({ onUs: true, fee: 0 })

          const remainingOnUsLimit = await this.user.remainingOnUsLimit()

          if (remainingOnUsLimit < tokens) {
            const error = `Cannot transfer more than ${this.config.limits.onUsLimit} sats in 24 hours`
            throw new TransactionRestrictedError(error, { logger: lightningLoggerOnUs })
          }

          let payeeUser, pubkey, payeeInvoice

          if (isPushPayment) {
            // pay through username
            payeeUser = await User.getUserByUsername(input_username)
          } else {
            // standard path, user scan a lightning invoice of our own wallet from another user
            payeeInvoice = await this.invoices.findByPaymentHash(id)
            if (payeeInvoice instanceof Error) {
              const error = `User tried to pay invoice from ${this.config.name}, but it does not exist`
              throw new LightningPaymentError(error, {
                logger: lightningLoggerOnUs,
                success: false,
              })
            }

            if (payeeInvoice.paid) {
              const error = `Invoice is already paid`
              throw new LightningPaymentError(error, {
                logger: lightningLoggerOnUs,
                success: false,
              })
            }

            ;({ pubkey } = payeeInvoice)
            payeeUser = await User.findOne({ _id: payeeInvoice.walletId })
          }

          if (!payeeUser) {
            const error = `this user doesn't exist`
            throw new NotFoundError(error, { logger: lightningLoggerOnUs })
          }

          if (String(payeeUser._id) === String(this.user._id)) {
            throw new SelfPaymentError(undefined, { logger: lightningLoggerOnUs })
          }

          const sats = tokens
          const metadata = {
            hash: id,
            pubkey,
            type: "on_us",
            pending: false,
            ...UserWallet.getCurrencyEquivalent({ sats, fee: 0 }),
          }

          // TODO: manage when paid fully in USD directly from USD balance to avoid conversion issue
          if (balanceSats < sats) {
            throw new InsufficientBalanceError(undefined, {
              logger: lightningLoggerOnUs,
            })
          }

          await lockExtendOrThrow({ lock, logger: lightningLoggerOnUs }, async () => {
            const tx = await ledger.addOnUsPayment({
              description: memoInvoice,
              sats,
              metadata,
              payerUser: this.user,
              payeeUser,
              memoPayer,
              shareMemoWithPayee: isPushPayment,
              lastPrice: UserWallet.lastPrice,
            })
            return tx
          })

          transactionNotification({
            amount: sats,
            user: payeeUser,
            hash: id,
            logger: this.logger,
            type: "paid-invoice",
          })

          const eventName = lnPaymentStatusEvent(id)
          pubsub.publish(eventName, { status: "PAID" })

          if (!isPushPayment) {
            // trying to delete the invoice first from lnd
            // if we failed to do it, the invoice would still be present in InvoiceUser
            // in case the invoice were to be paid another time independantly (unlikely outcome)
            try {
              const lndService = LndService()
              if (lndService instanceof Error) return lndService
              const deleteResult = lndService.cancelInvoice({
                pubkey,
                paymentHash: id,
              })
              if (deleteResult instanceof Error) throw deleteResult
              this.logger.info({ id, user: this.user }, "canceling invoice on lnd")

              payeeInvoice.paid = true
              payeeInvoice = await this.invoices.update(payeeInvoice)
              if (payeeInvoice instanceof Error) {
                this.logger.error(
                  { id, user: this.user, err: payeeInvoice },
                  "issue updating invoice",
                )
              }

              if (payeeInvoice.paid) {
                this.logger.info(
                  { id, user: this.user },
                  "invoice has been updated from InvoiceUser following on_us transaction",
                )
              }
            } catch (err) {
              this.logger.error({ id, user: this.user, err }, "issue deleting invoice")
            }
          }

          // adding contact for the payer
          if (payeeUser.username) {
            await addContact({ uid: this.user._id, username: payeeUser.username })
          }

          // adding contact for the payee
          if (this.user.username) {
            await addContact({ uid: payeeUser._id, username: this.user.username })
          }

          const remainingWithdrawalLimit = await this.user.remainingWithdrawalLimit()

          if (remainingWithdrawalLimit < tokens) {
            const error = `Cannot transfer more than ${this.config.limits.withdrawalLimit} sats in 24 hours`
            throw new TransactionRestrictedError(error, { logger: lightningLogger })
          }

          lightningLoggerOnUs.info(
            {
              isPushPayment,
              success: true,
              isReward: params.isReward ?? false,
              ...metadata,
            },
            "lightning payment success",
          )

          return "success"
        }

        // "normal" transaction: paying another lightning node
        if (!this.user.oldEnoughForWithdrawal) {
          const error = `New accounts have to wait ${this.config.limits.oldEnoughForWithdrawalHours}h before withdrawing`
          throw new NewAccountWithdrawalError(error, { logger: lightningLogger })
        }

        const remainingWithdrawalLimit = await this.user.remainingWithdrawalLimit()

        if (remainingWithdrawalLimit < tokens) {
          const error = `Cannot withdraw more than ${this.config.limits.withdrawalLimit} sats in 24 hours`
          throw new TransactionRestrictedError(error, { logger: lightningLogger })
        }

        // TODO: fine tune those values:
        // const probe_timeout_ms
        // const path_timeout_ms

        // TODO: push payment for other node as well
        lightningLogger = lightningLogger.child({ onUs: false, max_fee })

        const key = JSON.stringify({ id, mtokens })
        route = JSON.parse((await redis.get(key)) as string)
        this.logger.info({ route }, "route from redis")

        let pubkey: string, lnd: AuthenticatedLnd

        // TODO: check if route is not an array and we shouldn't use .length instead
        if (route) {
          lightningLogger = lightningLogger.child({ routing: "payViaRoutes", route })
          fee = route.safe_fee
          feeKnownInAdvance = true
          pubkey = route.pubkey

          try {
            ;({ lnd } = getLndFromPubkey({ pubkey }))
          } catch (err) {
            // lnd may have gone offline since the probe has been done.
            // deleting entry so that subsequent payment attempt could succeed
            await redis.del(key)
            throw err
          }
        } else {
          lightningLogger = lightningLogger.child({ routing: "payViaPaymentDetails" })
          fee = max_fee
          feeKnownInAdvance = false
          ;({ pubkey, lnd } = getActiveLnd())
        }

        // we are confident enough that there is a possible payment route. let's move forward
        // TODO quote for fees, and also USD for USD users

        let entry

        {
          const sats = tokens + fee

          const metadata = {
            hash: id,
            type: "payment",
            pending: true,
            pubkey,
            feeKnownInAdvance,
            ...UserWallet.getCurrencyEquivalent({ sats, fee }),
          }

          lightningLogger = lightningLogger.child({ route, balanceSats, ...metadata })

          // TODO usd management for balance

          if (balanceSats < sats) {
            throw new InsufficientBalanceError(undefined, { logger: lightningLogger })
          }

          entry = await lockExtendOrThrow({ lock, logger: lightningLogger }, async () => {
            // reduce balance from customer first
            const tx = await ledger.addLndPayment({
              description: memoInvoice,
              payerUser: this.user,
              sats,
              metadata,
              lastPrice: UserWallet.lastPrice,
            })
            return tx
          })

          // there is 3 scenarios for a payment.
          // 1/ payment succeed (function return before TIMEOUT_PAYMENT) and:
          // 1A/ fees are known in advance
          // 1B/ fees are not kwown in advance --> need to refund for the difference in fees?
          //   for now we keep the change

          // 2/ the payment fails. we are reverting it. this including voiding prior transaction
          // 3/ payment is still pending after TIMEOUT_PAYMENT.
          // we are timing out the request for UX purpose, so that the client can show the payment is pending
          // even if the payment is still ongoing from lnd.
          // to clean pending payments, another cron-job loop will run in the background.

          try {
            // Fixme: seems to be leaking if it timeout.
            if (route) {
              paymentPromise = payViaRoutes({ lnd, routes: [route], id })
            } else {
              // incoming_peer?
              // max_paths for MPP
              // max_timeout_height ??
              paymentPromise = payViaPaymentDetails({
                lnd,
                id,
                cltv_delta,
                destination,
                features,
                max_fee,
                mtokens,
                payment,
                routes: routeHint,
              })
            }

            await Promise.race([paymentPromise, timeout(TIMEOUT_PAYMENT, "Timeout")])
            // FIXME
            // return this.payDetail({
            //     pubkey: details.destination,
            //     hash: details.id,
            //     amount: details.tokens,
            //     routes: details.routes
            // })
          } catch (err) {
            if (err.message === "Timeout") {
              lightningLogger.warn({ ...metadata, pending: true }, "timeout payment")

              return "pending"
              // pending in-flight payment are being handled either by a cron job
              // or payment update when the user query his balanceSats
            }

            try {
              // FIXME: this query may not make sense
              // where multiple payment have the same hash
              // ie: when a payment is being retried

              await ledger.settleLndPayment(id)

              await ledger.voidTransactions(entry.journal._id, err[1])

              lightningLogger.warn(
                { success: false, err, ...metadata, entry },
                `payment error`,
              )
            } catch (err_fatal) {
              const error = `ERROR CANCELING PAYMENT ENTRY`
              throw new DbError(error, { logger: lightningLogger, level: "fatal" })
            }

            if (isInvoiceAlreadyPaidError(err)) {
              lightningLogger.warn(
                { ...metadata, pending: false },
                "invoice already paid",
              )
              return "already_paid"
            }

            throw new LightningPaymentError("Error paying invoice", {
              logger: lightningLogger,
              err,
              success: false,
            })
          }

          // success
          await ledger.settleLndPayment(id)
          const paymentResult = await paymentPromise

          if (!feeKnownInAdvance) {
            await this.recordFeeDifference({
              paymentResult,
              max_fee,
              id,
              related_journal: entry.journal._id,
            })
          }

          lightningLogger.info(
            { success: true, paymentResult, ...metadata },
            `payment success`,
          )
        }

        return "success"
      })
    }

    // this method is used when the probing failed
    //
    // there are times when it's not possible to know in advance the fees
    // this could be because the receiving doesn't respond to the fake payment hash
    // or because there is no liquidity for a one-sum payment, but there could
    // be liquidity if the payment was using MPP
    //
    // in this scenario, we have withdrawal a percent of fee (`max_fee`)
    // and once we know precisely how much the payment was we reimburse the difference
    async recordFeeDifference({ paymentResult, max_fee, id, related_journal }) {
      const feeDifference = max_fee - paymentResult.safe_fee

      assert(feeDifference >= 0)
      assert(feeDifference <= max_fee)

      this.logger.info(
        { paymentResult, feeDifference, max_fee, actualFee: paymentResult.safe_fee, id },
        "logging a fee difference",
      )

      const { usd } = UserWallet.getCurrencyEquivalent({ sats: feeDifference })
      const metadata = {
        currency: "BTC",
        hash: id,
        related_journal,
        type: "fee_reimbursement",
        usd,
        pending: false,
      }

      // todo: add a reference to the journal entry of the main tx

      await ledger.addLndReceipt({
        description: "fee reimbursement",
        payeeUser: this.user,
        metadata,
        sats: feeDifference,
        lastPrice: UserWallet.lastPrice,
      })
    }

    // TODO manage the error case properly. right now there is a mix of string being return
    // or error being thrown. Not sure how this is handled by GraphQL
  }
