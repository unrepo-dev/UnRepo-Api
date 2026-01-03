import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { chatWithRepository } from '../lib/ai.js';

const router = Router();
const prisma = new PrismaClient();

// Verify API key with unrepo_chatbot_ prefix
async function verifyApiKey(apiKey: string) {
  if (!apiKey.startsWith('unrepo_chatbot_')) {
    throw new Error('Invalid API key format. Chatbot API keys must start with unrepo_chatbot_');
  }

  const key = await prisma.apiKey.findFirst({
    where: {
      key: apiKey,
      type: 'CHATBOT',
      isActive: true,
    },
    include: {
      user: true,
    },
  });

  if (!key) {
    throw new Error('Invalid or inactive API key');
  }

  const isPremium = key.user.paymentVerified || key.user.isTokenHolder;

  // FREE TIER: 5 total calls per API key
  if (!isPremium && key.usageCount >= 5) {
    throw new Error('Free tier limit reached (5 calls). Please upgrade to continue using this API.');
  }

  // PREMIUM: Rate limit check (200 per hour)
  if (isPremium) {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    const recentUsage = await prisma.apiUsage.count({
      where: {
        apiKeyId: key.id,
        createdAt: { gte: oneHourAgo },
      },
    });

    if (recentUsage >= 200) {
      throw new Error('Rate limit exceeded. Maximum 200 requests per hour.');
    }
  }

  // Update usage stats
  await prisma.apiKey.update({
    where: { id: key.id },
    data: {
      usageCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });

  return key;
}

// Verify wallet has chat access
async function verifyWalletAccess(walletAddress: string) {
  const walletUser = await prisma.walletUser.findUnique({
    where: { walletAddress }
  });

  if (!walletUser) {
    throw new Error('Wallet not registered. Please connect and register your wallet first.');
  }

  // Check if user has remaining chats (5 chat limit per wallet)
  if (walletUser.chatUsed >= walletUser.chatLimit) {
    throw new Error(`Chat limit reached (${walletUser.chatLimit} free chats). Hold $UNREPO tokens for unlimited access or use an API key.`);
  }

  // Increment usage count
  await prisma.walletUser.update({
    where: { walletAddress },
    data: {
      chatUsed: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });

  return walletUser;
}

// POST /api/v1/chatbot
router.post('/', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'] as string;
    const walletAddress = req.headers['x-wallet-address'] as string;
    
    console.log('📨 Chatbot request received');
    console.log('API Key:', apiKey ? apiKey.substring(0, 20) + '...' : 'NONE');
    console.log('Wallet:', walletAddress || 'NONE');
    
    if (!apiKey && !walletAddress) {
      return res.status(401).json({ 
        success: false,
        error: 'API key or wallet address is required' 
      });
    }

    let userId: string | null = null;
    let keyId: string | null = null;

    // Verify API key OR wallet
    if (apiKey) {
      console.log('🔑 Verifying API key...');
      const key = await verifyApiKey(apiKey);
      console.log('✅ API key verified for user:', key.userId);
      userId = key.userId;
      keyId = key.id;
    } else if (walletAddress) {
      console.log('👛 Verifying wallet access...');
      const wallet = await verifyWalletAccess(walletAddress);
      console.log('✅ Wallet verified:', walletAddress, `(${wallet.chatUsed}/${wallet.chatLimit})`);
    }

    // Get request body
    const { message, repoUrl, repoContext = {}, conversationHistory = [] } = req.body;
    console.log('💬 Message:', message?.substring(0, 50));
    console.log('📁 RepoUrl:', repoUrl);

    if (!message) {
      return res.status(400).json({ 
        success: false,
        error: 'Message is required' 
      });
    }

    // Build conversation context
    const messages = [
      ...conversationHistory,
      { role: 'user', content: message }
    ];

    // Call AI with repository context
    console.log('🤖 Calling AI...');
    const response = await chatWithRepository(
      messages,
      {
        repoUrl: repoUrl || '',
        repoOwner: repoContext.owner || '',
        repoName: repoContext.name || '',
        files: repoContext.files || [],
      }
    );
    console.log('✅ AI response received:', response?.substring(0, 100));

    // Log API usage (only if using API key)
    if (userId && keyId) {
      await prisma.apiUsage.create({
        data: {
          userId: userId,
          apiKeyId: keyId,
          endpoint: '/api/v1/chatbot',
          method: 'POST',
          requestData: JSON.stringify({ message, repoUrl }),
        },
      });

      // Save chat messages (only for API key users)
      await prisma.chatMessage.createMany({
        data: [
          {
            userId: userId,
            sessionId: `api_${keyId}_${Date.now()}`,
            role: 'user',
            content: message,
            repoContext: repoUrl,
          },
          {
            userId: userId,
            sessionId: `api_${keyId}_${Date.now()}`,
            role: 'assistant',
            content: response,
            repoContext: repoUrl,
          },
        ],
      });
    }

    res.json({
      success: true,
      data: {
        response,
        conversationHistory: [
          ...messages,
          { role: 'assistant', content: response }
        ],
        usage: walletAddress 
          ? { type: 'wallet', remaining: 'check dashboard' }
          : { count: 'check dashboard', limit: 5 }
      }
    });
  } catch (error: any) {
    console.error('❌ Chatbot API error:', error);
    console.error('Error stack:', error.stack);
    
    if (error.message.includes('limit') || error.message.includes('Invalid') || error.message.includes('Wallet')) {
      return res.status(429).json({ 
        success: false,
        error: error.message 
      });
    }
    
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to process request' 
    });
  }
});

export default router;
