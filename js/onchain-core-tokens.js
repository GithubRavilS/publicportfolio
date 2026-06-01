/**
 * Основные ERC-20 для RPC balanceOf (сети без Etherscan Free / дополнение к tokentx).
 */
export const CORE_ERC20 = {
  eth: [
    { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6 },
    { address: "0xdac17f958d2ee523a2206206994597c13d831ec7", symbol: "USDT", decimals: 6 },
    { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", symbol: "WETH", decimals: 18 },
    { address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", symbol: "WBTC", decimals: 8 },
    { address: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0", symbol: "wstETH", decimals: 18 },
  ],
  base: [
    { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6 },
    { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 },
    { address: "0xd9aaec86b65d86f6a7b5b1b0c42fc515ead23fc9", symbol: "USDbC", decimals: 6 },
    { address: "0x2ae3f1ec7f1f2c2093ba4ca259012010ef0274bd", symbol: "wstETH", decimals: 18 },
  ],
  arb: [
    { address: "0xaf88d065e77c8cc2239328c0dfb60a416255c15", symbol: "USDC", decimals: 6 },
    { address: "0xff970a61a04b1c148a34d43f5de4533ebddb5cc8", symbol: "USDC.e", decimals: 6 },
    { address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", symbol: "WETH", decimals: 18 },
    { address: "0x2f2f2548b76c358c894a58b8f9954a9fbfef9b17", symbol: "WBTC", decimals: 8 },
    { address: "0x5979d7b546e38e414ce7ef975d48c6227b3e1096", symbol: "wstETH", decimals: 18 },
    { address: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", symbol: "USDT", decimals: 6 },
  ],
  op: [
    { address: "0x0b2c639c533813f4aa9d7837ca1a1d3c852c2a7", symbol: "USDC", decimals: 6 },
    { address: "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", symbol: "USDT", decimals: 6 },
    { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 },
    { address: "0x1f32b1cA239c023c2Bc53250b938E7C2b85e718", symbol: "wstETH", decimals: 18 },
    { address: "0x68f180fcCe6838Be2ebe343cbb1400Ef7f6996e", symbol: "WBTC", decimals: 8 },
  ],
  matic: [
    { address: "0x3c499c542cef5e3811e119ce41d8db6e58e488b", symbol: "USDC", decimals: 6 },
    { address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", symbol: "WMATIC", decimals: 18 },
    { address: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", symbol: "WETH", decimals: 18 },
  ],
  bsc: [
    { address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", symbol: "USDC", decimals: 18 },
    { address: "0x55d398326f99059ff775485246999027b3197955", symbol: "USDT", decimals: 18 },
    { address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", symbol: "WBNB", decimals: 18 },
  ],
  avax: [
    { address: "0xb97ef9ef87323c769e358b8b0e1ba07a2b2415c0", symbol: "USDC", decimals: 6 },
    { address: "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7", symbol: "WAVAX", decimals: 18 },
  ],
};
