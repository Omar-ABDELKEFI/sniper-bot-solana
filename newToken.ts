// Import necessary modules
import {
    LIQUIDITY_STATE_LAYOUT_V4,
    LiquidityPoolKeys,
    LiquidityStateV4,
  } from '@raydium-io/raydium-sdk';
  import {
    MARKET_STATE_LAYOUT_V3,
    MarketStateV3,
  } from '@solana/serum';
  import { Connection, PublicKey, Commitment, KeyedAccountInfo } from '@solana/web3.js';
  import { getMinimalMarketV3 } from './market';
  import { getTokenAccounts } from './liquidity';
  import { retrieveEnvVariable } from './utils';
  import pino from 'pino';
  
  // Set up logging
  const logger = pino({ level: 'trace' });
  
  const RPC_ENDPOINT = retrieveEnvVariable('RPC_ENDPOINT', logger);
  const RPC_WEBSOCKET_ENDPOINT = retrieveEnvVariable('RPC_WEBSOCKET_ENDPOINT', logger);
  const commitment: Commitment = retrieveEnvVariable('COMMITMENT_LEVEL', logger) as Commitment;
  
  const solanaConnection = new Connection(RPC_ENDPOINT, {
    wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  });
  
  // Global variables
  let existingLiquidityPools: Set<string> = new Set<string>();
  let existingOpenBookMarkets: Set<string> = new Set<string>();
  let snipeList: string[] = [];
  
  // Load snipe list from file
  function loadSnipeList() {
    if (!retrieveEnvVariable('USE_SNIPE_LIST', logger)) {
      return;
    }
    const data = fs.readFileSync(path.join(__dirname, 'snipe-list.txt'), 'utf-8');
    snipeList = data.split('\n').map((a) => a.trim()).filter((a) => a);
    logger.info(`Loaded snipe list: ${snipeList.length}`);
  }
  
  // Check if the token should be bought
  function shouldBuy(key: string): boolean {
    return retrieveEnvVariable('USE_SNIPE_LIST', logger) ? snipeList.includes(key) : true;
  }
  
  // Process Raydium Pool
  async function processRaydiumPool(id: PublicKey, poolState: LiquidityStateV4) {
    if (!shouldBuy(poolState.baseMint.toString())) {
      return;
    }
  
    if (retrieveEnvVariable('CHECK_IF_MINT_IS_RENOUNCED', logger) === 'true') {
      const mintOption = await checkMintable(poolState.baseMint);
      if (mintOption !== true) {
        logger.warn({ mint: poolState.baseMint }, 'Skipping, owner can mint tokens!');
        return;
      }
    }
  
    // Process the token (this part will be in the buy section)
  }
  
  // Check if a mint is renounced
  async function checkMintable(vault: PublicKey): Promise<boolean | undefined> {
    try {
      let { data } = (await solanaConnection.getAccountInfo(vault)) || {};
      if (!data) {
        return;
      }
      const deserialize = MintLayout.decode(data);
      return deserialize.mintAuthorityOption === 0;
    } catch (e) {
      logger.debug(e);
      logger.error({ mint: vault }, `Failed to check if mint is renounced`);
    }
  }
  
  // Process OpenBook Market
  async function processOpenBookMarket(updatedAccountInfo: KeyedAccountInfo) {
    let accountData: MarketStateV3 | undefined;
    try {
      accountData = MARKET_STATE_LAYOUT_V3.decode(updatedAccountInfo.accountInfo.data);
      if (existingTokenAccounts.has(accountData.baseMint.toString())) {
        return;
      }
      // Save token account data (this part will be in the buy section)
    } catch (e) {
      logger.debug(e);
      logger.error({ mint: accountData?.baseMint }, `Failed to process market`);
    }
  }
  
  // Main listener function
  const runListener = async () => {
    loadSnipeList();
  
    const raydiumSubscriptionId = solanaConnection.onProgramAccountChange(
      RAYDIUM_LIQUIDITY_PROGRAM_ID_V4,
      async (updatedAccountInfo) => {
        const key = updatedAccountInfo.accountId.toString();
        const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(updatedAccountInfo.accountInfo.data);
        const poolOpenTime = parseInt(poolState.poolOpenTime.toString());
        const existing = existingLiquidityPools.has(key);
  
        if (poolOpenTime > Date.now() / 1000 && !existing) {
          existingLiquidityPools.add(key);
          await processRaydiumPool(updatedAccountInfo.accountId, poolState);
        }
      },
      commitment,
      [
        { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
            bytes: quoteToken.mint.toBase58(),
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId'),
            bytes: OPENBOOK_PROGRAM_ID.toBase58(),
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
            bytes: bs58.encode([6, 0, 0, 0, 0, 0, 0, 0]),
          },
        },
      ],
    );
  
    const openBookSubscriptionId = solanaConnection.onProgramAccountChange(
      OPENBOOK_PROGRAM_ID,
      async (updatedAccountInfo) => {
        const key = updatedAccountInfo.accountId.toString();
        const existing = existingOpenBookMarkets.has(key);
        if (!existing) {
          existingOpenBookMarkets.add(key);
          await processOpenBookMarket(updatedAccountInfo);
        }
      },
      commitment,
      [
        { dataSize: MARKET_STATE_LAYOUT_V3.span },
        {
          memcmp: {
            offset: MARKET_STATE_LAYOUT_V3.offsetOf('quoteMint'),
            bytes: quoteToken.mint.toBase58(),
          },
        },
      ],
    );
  
    logger.info(`Listening for Raydium changes: ${raydiumSubscriptionId}`);
    logger.info(`Listening for OpenBook changes: ${openBookSubscriptionId}`);
  
    if (retrieveEnvVariable('USE_SNIPE_LIST', logger)) {
      setInterval(loadSnipeList, Number(retrieveEnvVariable('SNIPE_LIST_REFRESH_INTERVAL', logger)));
    }
  };
  
  runListener();
  