import { setupMongoConnection } from "../mongodb";
import { Price } from "../priceImpl";
import { baseLogger, getBosScore } from "../utils";
import { getDealerWallet, getFunderWallet } from "../walletFactory";
import { SpecterWallet } from "../SpecterWallet"
import { getBalanceSheet, balanceSheetIsBalanced } from "../ledger/balanceSheet"
import { lndBalances } from "../lndUtils"
import { User } from "../schema";

const logger = baseLogger.child({module: "exporter"})

import express from 'express'
const server = express();

import client from 'prom-client'
import { register } from 'prom-client'

const prefix = "galoy"

const liabilities_g = new client.Gauge({ name: `${prefix}_liabilities`, help: 'how much money customers has' })
const lightning_g = new client.Gauge({ name: `${prefix}_lightning`, help: 'how much money there is our books for lnd' })
const userCount_g = new client.Gauge({ name: `${prefix}_userCount`, help: 'how much users have registered' })
const lnd_g = new client.Gauge({ name: `${prefix}_lnd`, help: 'how much money in our node' })
const lndOnChain_g = new client.Gauge({ name: `${prefix}_lnd_onchain`, help: 'how much fund is onChain in lnd' })
const lndOffChain_g = new client.Gauge({ name: `${prefix}_lnd_offchain`, help: 'how much fund is offChain in our node' })
const lndOpeningChannelBalance_g = new client.Gauge({ name: `${prefix}_lnd_openingchannelbalance`, help: 'how much fund is pending following opening channel' })
const lndClosingChannelBalance_g = new client.Gauge({ name: `${prefix}_lnd_closingchannelbalance`, help: 'how much fund is closing following force closed channel' })
const usdShortPosition_g = new client.Gauge({ name: `${prefix}_usdShortPosition`, help: 'usd short position on ftx' })
const totalAccountValue_g = new client.Gauge({ name: `${prefix}_totalAccountValue`, help: 'totalAccountValue on ftx' })
const ftx_btc_g = new client.Gauge({ name: `${prefix}_ftxBtcBalance`, help: 'btc balance in ftx' })
const ftx_usdPnl_g = new client.Gauge({ name: `${prefix}_ftxUsdPnl`, help: 'usd balance in FTX, which also represents the PNL' })
const funder_balance_BTC_g = new client.Gauge({ name: `${prefix}_funderBalance_BTC`, help: 'funder balance BTC' })
const dealer_local_btc_g = new client.Gauge({ name: `${prefix}_dealerLocalBtcBalance`, help: 'btc balance in for the dealer in the node' })
const dealer_local_usd_g = new client.Gauge({ name: `${prefix}_dealerLocalUsdBalance`, help: 'usd liabilities for the dealer' })
const dealer_profit_g = new client.Gauge({ name: `${prefix}_dealerProfit`, help: 'profit of the dealer wallet' })
const leverage_g = new client.Gauge({ name: `${prefix}_leverage`, help: 'leverage ratio on ftx' })
const fundingRate_g = new client.Gauge({ name: `${prefix}_fundingRate`, help: 'FTX hourly funding rate' })
const assetsLiabilitiesDifference_g = new client.Gauge({ name: `${prefix}_assetsEqLiabilities`, help: 'do we have a balanced book' })
const bookingVersusRealWorldAssets_g = new client.Gauge({ name: `${prefix}_lndBalanceSync`, help: 'are lnd in syncs with our books' })
const price_g = new client.Gauge({ name: `${prefix}_price`, help: 'BTC/USD price' })
const bos_g = new client.Gauge({ name: `${prefix}_bos`, help: 'bos score' })
const specter_g = new client.Gauge({ name: `${prefix}_bitcoind`, help: 'amount in cold storage' })


const main = async () => {
  server.get('/metrics', async (req, res) => {
    
    try {
      const price = new Price({ logger })
      price_g.set(await price.lastPrice())
    } catch (err) {
      logger.error({err}, `issue getting price`)
    }
    
    try {
      const bosScore = await getBosScore()
      bos_g.set(bosScore)
    } catch(err) {
      logger.error({ err }, `error getting and setting bos score`)
    }
    
    const { lightning, liabilities } = await getBalanceSheet()
    const { assetsLiabilitiesDifference, bookingVersusRealWorldAssets } = await balanceSheetIsBalanced()
    liabilities_g.set(liabilities)
    lightning_g.set(lightning)
    assetsLiabilitiesDifference_g.set(assetsLiabilitiesDifference)
    bookingVersusRealWorldAssets_g.set(bookingVersusRealWorldAssets)
    
    const { total, onChain, offChain, opening_channel_balance, closing_channel_balance } = await lndBalances()
    lnd_g.set(total)
    lndOnChain_g.set(onChain)
    lndOffChain_g.set(offChain)
    lndOpeningChannelBalance_g.set(opening_channel_balance)
    lndClosingChannelBalance_g.set(closing_channel_balance)
    // price_g.set(price)
      
    const userCount = await User.countDocuments()
    userCount_g.set(userCount)
    
    const funderWallet = await getFunderWallet({ logger })
    const { BTC: funderBalance } = await funderWallet.getBalances()
    funder_balance_BTC_g.set(funderBalance)


    const dealerWallet = await getDealerWallet({ logger })
    const { usd: usdShortPosition, totalAccountValue, leverage } = await dealerWallet.getAccountPosition()

    ftx_btc_g.set((await dealerWallet.getExchangeBalance()).sats)
    ftx_usdPnl_g.set((await dealerWallet.getExchangeBalance()).usdPnl)
    dealer_local_btc_g.set((await dealerWallet.getLocalLiabilities()).satsLnd)
    dealer_local_usd_g.set((await dealerWallet.getLocalLiabilities()).usd)
    dealer_profit_g.set((await dealerWallet.getProfit()).usdProfit)

    totalAccountValue_g.set(totalAccountValue)
    usdShortPosition_g.set(usdShortPosition)
    leverage_g.set(leverage)

    fundingRate_g.set(await dealerWallet.getNextFundingRate())

    const specterWallet = new SpecterWallet({ logger })
    specter_g.set(await specterWallet.getBitcoindBalance())

    res.set('Content-Type', register.contentType);
    res.end(register.metrics());
  })

  server.get('/healthz', async (req, res) => {
    res.send('OK')
  })
    
  const port = process.env.PORT || 3000;
  logger.info(
    `Server listening to ${port}, metrics exposed on /metrics endpoint`,
  )
  server.listen(port);
}

setupMongoConnection().then(() => main()).catch((err) => logger.error(err))