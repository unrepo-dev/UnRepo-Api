import 'dotenv/config';

const HELIUS_API_KEY = '8bff5899-6c9b-4630-92a3-2c9a23fd714f';
const UNREPO_TOKEN_MINT = 'F5kKqk9PPfYPXWdaXjsoksnab4xTFQmiKnCk1FTXpump';

// Test with a sample wallet - replace with your wallet address that has tokens
const testWallet = 'FyDesNXC3bP8q9qYYkHY9VSD4aWrxQ6AZiiWEXUxTZPv';

async function testToken2022() {
  console.log('Testing Token-2022 Balance Check...');
  console.log('Wallet:', testWallet);
  console.log('Token Mint:', UNREPO_TOKEN_MINT);
  console.log('Method: getTokenAccountsByOwner\n');
  
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'test',
        method: 'getTokenAccountsByOwner',
        params: [
          testWallet,
          { mint: UNREPO_TOKEN_MINT },
          { encoding: 'jsonParsed' }
        ]
      })
    });
    
    const data = await response.json() as any;
    
    console.log('=== RPC Response ===');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.error) {
      console.log('\n❌ RPC Error:', data.error.message);
      return;
    }
    
    if (data.result?.value?.length > 0) {
      const tokenAccount = data.result.value[0];
      const balance = tokenAccount.account.data.parsed.info.tokenAmount;
      console.log('\n✅ Token Account Found!');
      console.log('Balance:', balance.uiAmount, 'UNREPO');
      console.log('Raw amount:', balance.amount);
      console.log('Decimals:', balance.decimals);
      
      const program = tokenAccount.account.data.program;
      console.log('Program:', program);
      console.log('Is Token-2022:', program === 'spl-token-2022');
    } else {
      console.log('\n❌ No token account found');
      console.log('Please provide a wallet address that holds UNREPO tokens');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error);
  }
}

async function testHelius() {
  console.log('Testing Helius API...');
  console.log('Wallet:', testWallet);
  console.log('Looking for token:', UNREPO_TOKEN_MINT);
  
  // Try the RPC method which is more reliable
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  
  try {
    console.log('\n=== Testing RPC Method ===');
    const rpcResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'test',
        method: 'getTokenAccountsByOwner',
        params: [
          testWallet,
          { mint: UNREPO_TOKEN_MINT },
          { encoding: 'jsonParsed' }
        ]
      })
    });
    
    const rpcData = await rpcResponse.json() as any;
    console.log('RPC Response:', JSON.stringify(rpcData, null, 2));
    
    if (rpcData.result?.value?.length > 0) {
      const tokenAccount = rpcData.result.value[0];
      const balance = tokenAccount.account.data.parsed.info.tokenAmount;
      console.log('\n✅ Token Account Found!');
      console.log('Balance:', balance.uiAmount, 'UNREPO');
      console.log('Raw amount:', balance.amount);
    } else {
      console.log('\n❌ No token account found for this mint');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
  
  // Also try the balances endpoint
  console.log('\n=== Testing Balances Endpoint ===');
  const balanceUrl = `https://api.helius.xyz/v0/addresses/${testWallet}/balances?api-key=${HELIUS_API_KEY}`;
  
  try {
    const response = await fetch(balanceUrl);
    const data = await response.json() as any;
    
    console.log('Balance Response:', JSON.stringify(data, null, 2));
    
    if (data.tokens && data.tokens.length > 0) {
      console.log('\nTokens found:', data.tokens.length);
      const unrepoToken = data.tokens.find((t: any) => 
        t.mint.toLowerCase() === UNREPO_TOKEN_MINT.toLowerCase()
      );
      
      if (unrepoToken) {
        console.log('✅ UNREPO Token Found in balances!');
        console.log(JSON.stringify(unrepoToken, null, 2));
      }
    }
  } catch (error) {
    console.error('Balance endpoint error:', error);
  }
}

testToken2022();
