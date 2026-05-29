/**
 * Реестр сетей и контрактов для ончейн-портфеля.
 */

export const MULTICALL3 = "0xca11bde05977b3631167028712e18dae126b14d";

export const FLUID_LENDING_RESOLVER = "0x48D32f49aFeAEC7AE66ad7B9264f446fc11a1569";
export const FLUID_VAULT_RESOLVER = "0xA5C3E16523eeeDDcC34706b0E6bE88b4c6EA95cC";

/** Uniswap V3 NFPM — chain-specific (CREATE2 / L2 deploy). */
export const UNI_V3_NFPM = {
  eth: "0xc36442b4a4528e0023c12d580d40bc8e907d24e5",
  base: "0x03a520b32c04bf3beef7beb72e919cf822ed34f1",
  arb: "0xc36442b4a4528e0023c12d580d40bc8e907d24e5",
  op: "0xC36442b4a4528e0023c12d580d40bc8e907d24e5",
  matic: "0xC36442b4a4528e0023c12d580d40bc8e907d24e5",
  scroll: "0x03a520b32c04bf3beef7beb72e919cf822ed34f1",
  linea: "0x03a520b32c04bf3beef7beb72e919cf822ed34f1",
  blast: "0x03a520b32c04bf3beef7beb72e919cf822ed34f1",
  gnosis: "0xC36442b4a4528e0023c12d580d40bc8e907d24e5",
};

export const PANCAKE_V3_NFPM = {
  base: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
  arb: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
  bsc: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
};

export const CHAIN_IDS = {
  eth: 1,
  base: 8453,
  arb: 42161,
  op: 10,
  matic: 137,
  bsc: 56,
  avax: 43114,
  scroll: 534352,
  linea: 59144,
  blast: 81457,
  gnosis: 100,
};

export const NATIVE_SYMBOL = {
  eth: "ETH",
  base: "ETH",
  arb: "ETH",
  op: "ETH",
  matic: "MATIC",
  bsc: "BNB",
  avax: "AVAX",
  scroll: "ETH",
  linea: "ETH",
  blast: "ETH",
  gnosis: "xDAI",
};

/** @type {Record<string, { rpc: string[], scan: boolean, nfpm: object[], aave?: object, fluid?: boolean, gmx?: object }>} */
export const CHAINS = {
  eth: {
    rpc: [
      "https://ethereum-rpc.publicnode.com",
      "https://eth.drpc.org",
      "https://1rpc.io/eth",
      "https://rpc.ankr.com/eth",
    ],
    scan: true,
    multicall: MULTICALL3,
    fluid: true,
    nfpm: [
      {
        protocol: "Uniswap V3",
        address: UNI_V3_NFPM.eth,
        factory: "0x1f98431c8ad98523631ae4a59f267346ea31f984",
        feeDiv: 10000,
      },
    ],
    aave: {
      protocol: "Aave V3",
      pool: "0x87870bca3f3fd6335c3f4e2d2e6550e1d3f4b5c0",
    },
  },
  base: {
    rpc: [
      "https://base-rpc.publicnode.com",
      "https://mainnet.base.org",
      "https://base.drpc.org",
      "https://1rpc.io/base",
    ],
    scan: true,
    multicall: MULTICALL3,
    fluid: true,
    nfpm: [
      {
        protocol: "Uniswap V3",
        address: UNI_V3_NFPM.base,
        factory: "0x33128a8fc17869897dc68a0263f970ae9ce2eb20",
        feeDiv: 10000,
      },
      {
        protocol: "Aerodrome V3",
        address: "0x827922686190790b37229fd06084350e74485b72",
        factory: "0x5e7bb104d84c7cb9b862aa17d06711c10013949f",
        feeDiv: 2000,
      },
      {
        protocol: "PancakeSwap V3",
        address: PANCAKE_V3_NFPM.base,
        factory: "0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865",
        feeDiv: 10000,
      },
    ],
    aave: {
      protocol: "Aave V3",
      pool: "0xa238dd80c259a72e81d7e4664a980a968b238f5",
    },
  },
  arb: {
    rpc: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
    scan: true,
    multicall: MULTICALL3,
    fluid: true,
    gmx: {
      protocol: "GMX V2",
      reader: "0x470fbC46bcC0f16532691Df360A07d8Bf5ee0789",
      dataStore: "0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8",
    },
    nfpm: [
      {
        protocol: "Uniswap V3",
        address: UNI_V3_NFPM.arb,
        factory: "0x1f98431c8ad98523631ae4a59f267346ea31f984",
        feeDiv: 10000,
      },
      {
        protocol: "PancakeSwap V3",
        address: PANCAKE_V3_NFPM.arb,
        factory: "0x0BFbCF9fa4f9c56b0f40A671ad40e0802a091865",
        feeDiv: 10000,
      },
    ],
    aave: {
      protocol: "Aave V3",
      pool: "0x794613f7df38654b07e5c4a8a4e239e38af8c194",
    },
  },
  op: {
    rpc: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"],
    scan: true,
    multicall: MULTICALL3,
    nfpm: [
      {
        protocol: "Uniswap V3",
        address: UNI_V3_NFPM.op,
        factory: "0x1f98431c8ad98523631ae4a59f267346ea31f984",
        feeDiv: 10000,
      },
    ],
    aave: {
      protocol: "Aave V3",
      pool: "0x794613f7df38654b07e5c4a8a4e239e38af8c194",
    },
  },
  matic: {
    rpc: ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"],
    scan: true,
    multicall: MULTICALL3,
    fluid: true,
    nfpm: [
      {
        protocol: "Uniswap V3",
        address: UNI_V3_NFPM.matic,
        factory: "0x1f98431c8ad98523631ae4a59f267346ea31f984",
        feeDiv: 10000,
      },
    ],
    aave: {
      protocol: "Aave V3",
      pool: "0x794613f7df38654b07e5c4a8a4e239e38af8c194",
    },
  },
  bsc: {
    rpc: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org"],
    scan: true,
    multicall: MULTICALL3,
    nfpm: [
      {
        protocol: "PancakeSwap V3",
        address: PANCAKE_V3_NFPM.bsc,
        factory: "0x1f98431c8ad98523631ae4a59f267346ea31f984",
        feeDiv: 10000,
      },
    ],
  },
  scroll: {
    rpc: ["https://scroll-rpc.publicnode.com", "https://rpc.scroll.io"],
    scan: true,
    multicall: MULTICALL3,
    nfpm: [
      {
        protocol: "Uniswap V3",
        address: UNI_V3_NFPM.scroll,
        factory: "0x1f98431c8ad98523631ae4a59f267346ea31f984",
        feeDiv: 10000,
      },
    ],
  },
  linea: {
    rpc: ["https://linea-rpc.publicnode.com", "https://rpc.linea.build"],
    scan: true,
    multicall: MULTICALL3,
    nfpm: [
      {
        protocol: "Uniswap V3",
        address: UNI_V3_NFPM.linea,
        factory: "0x1f98431c8ad98523631ae4a59f267346ea31f984",
        feeDiv: 10000,
      },
    ],
  },
  blast: {
    rpc: ["https://blast-rpc.publicnode.com", "https://rpc.blast.io"],
    scan: true,
    multicall: MULTICALL3,
    nfpm: [
      {
        protocol: "Uniswap V3",
        address: UNI_V3_NFPM.blast,
        factory: "0x1f98431c8ad98523631ae4a59f267346ea31f984",
        feeDiv: 10000,
      },
    ],
  },
  gnosis: {
    rpc: ["https://gnosis-rpc.publicnode.com", "https://rpc.gnosischain.com"],
    scan: true,
    multicall: MULTICALL3,
    nfpm: [
      {
        protocol: "Uniswap V3",
        address: UNI_V3_NFPM.gnosis,
        factory: "0x1f98431c8ad98523631ae4a59f267346ea31f984",
        feeDiv: 10000,
      },
    ],
  },
};

export const SCAN_CHAINS = Object.keys(CHAINS).filter((c) => CHAINS[c].scan);

export const COINGECKO_IDS = {
  ETH: "ethereum",
  WETH: "ethereum",
  STETH: "ethereum",
  WSTETH: "ethereum",
  USDC: "usd-coin",
  USDT: "tether",
  DAI: "dai",
  WBTC: "wrapped-bitcoin",
  CBBTC: "coinbase-wrapped-btc",
  BTC: "bitcoin",
  BNB: "binancecoin",
  MATIC: "matic-network",
  POL: "matic-network",
  AVAX: "avalanche-2",
  ARB: "arbitrum",
  OP: "optimism",
  GHO: "gho",
  RLUSD: "rlusd",
  XAUT: "tether-gold",
  DUST: "dust-protocol",
  AERO: "aerodrome-finance",
  CAKE: "pancakeswap-token",
  GMX: "gmx",
  PENDLE: "pendle",
  AAVE: "aave",
  LINK: "chainlink",
  UNI: "uniswap",
  SYRUPUSDT: "syrupusdt",
  USDT0: "tether",
};
