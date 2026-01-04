// Helius API integration for token holder verification
import 'dotenv/config';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const UNREPO_TOKEN_MINT = process.env.UNREPO_TOKEN_MINT || 'F5kKqk9PPfYPXWdaXjsoksnab4xTFQmiKnCk1FTXpump';
const TOKEN_DECIMALS = parseInt(process.env.UNREPO_TOKEN_DECIMALS || '6');
const TOKEN_THRESHOLD = parseInt(process.env.UNREPO_TOKEN_THRESHOLD || '1000000'); // 1 million tokens

interface TokenBalance {
  mint: string;
  amount: number;
  decimals: number;
  tokenAccount: string;
}

interface HeliusTokenResponse {
  tokens: Array<{
    mint: string;
    amount: number;
    decimals: number;
    tokenAccount: string;
  }>;
}

/**
 * Get all token balances for a wallet using Helius API
 */
export async function getTokenBalances(walletAddress: string): Promise<TokenBalance[]> {
  if (!HELIUS_API_KEY) {
    throw new Error('HELIUS_API_KEY not configured');
  }

  const url = `https://api.helius.xyz/v0/addresses/${walletAddress}/balances?api-key=${HELIUS_API_KEY}`;
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Helius API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as HeliusTokenResponse;
    return data.tokens || [];
  } catch (error) {
    console.error('Error fetching token balances:', error);
    throw error;
  }
}

/**
 * Get Token-2022 balance using Solana RPC
 * Token-2022 tokens require direct RPC calls instead of REST API
 */
export async function getToken2022Balance(walletAddress: string, mintAddress: string): Promise<number> {
  if (!HELIUS_API_KEY) {
    throw new Error('HELIUS_API_KEY not configured');
  }

  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  
  try {
    // Get token accounts for this specific mint (works for both Token and Token-2022)
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'token-check',
        method: 'getTokenAccountsByOwner',
        params: [
          walletAddress,
          { mint: mintAddress },
          { encoding: 'jsonParsed' }
        ]
      })
    });

    const data = await response.json() as any;

    if (data.error) {
      console.error('RPC Error:', data.error);
      return 0;
    }

    if (data.result?.value?.length > 0) {
      const tokenAccount = data.result.value[0];
      const balance = tokenAccount.account.data.parsed.info.tokenAmount;
      return parseFloat(balance.uiAmount || '0');
    }

    return 0;
  } catch (error) {
    console.error('Error fetching Token-2022 balance:', error);
    return 0;
  }
}

/**
 * Check if wallet holds the required UNREPO tokens
 * Returns the token balance if found, or 0 if not holding
 * NOTE: UNREPO is a Token-2022 token, so we use RPC instead of REST API
 */
export async function checkUnrepoTokenBalance(walletAddress: string): Promise<number> {
  try {
    // UNREPO is a Token-2022 token, use direct RPC call
    console.log(`🔍 Checking Token-2022 balance for ${walletAddress.slice(0, 8)}...`);
    const balance = await getToken2022Balance(walletAddress, UNREPO_TOKEN_MINT);
    
    if (balance > 0) {
      console.log(`💰 Wallet ${walletAddress.slice(0, 8)}... holds ${balance.toLocaleString()} UNREPO tokens (Token-2022)`);
    } else {
      console.log(`💰 Wallet ${walletAddress.slice(0, 8)}... does not hold UNREPO token`);
    }
    
    return balance;
  } catch (error) {
    console.error('Error checking UNREPO token balance:', error);
    return 0;
  }
}

/**
 * Verify if wallet is a token holder (holds >= threshold tokens)
 */
export async function verifyTokenHolder(walletAddress: string): Promise<{
  isTokenHolder: boolean;
  tokenBalance: number;
  threshold: number;
}> {
  const tokenBalance = await checkUnrepoTokenBalance(walletAddress);
  const isTokenHolder = tokenBalance >= TOKEN_THRESHOLD;

  console.log(`🔍 Token verification for ${walletAddress.slice(0, 8)}...:`);
  console.log(`   Balance: ${tokenBalance.toLocaleString()} UNREPO`);
  console.log(`   Threshold: ${TOKEN_THRESHOLD.toLocaleString()} UNREPO`);
  console.log(`   Is Token Holder: ${isTokenHolder ? '✅ YES' : '❌ NO'}`);

  return {
    isTokenHolder,
    tokenBalance,
    threshold: TOKEN_THRESHOLD,
  };
}

/**
 * Get token holder status with caching consideration
 * Token checks should be cached to avoid rate limiting
 */
export function getTokenThreshold(): number {
  return TOKEN_THRESHOLD;
}

export function getTokenMint(): string {
  return UNREPO_TOKEN_MINT;
}
