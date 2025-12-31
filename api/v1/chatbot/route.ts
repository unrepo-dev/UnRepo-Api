import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { chatWithRepository } from '@/lib/ai';
import { successResponse, errorResponse } from '@/lib/validation';
import { rateLimit, RATE_LIMITS, checkPremiumRateLimit, addRateLimitHeaders } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
};

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}

// Verify API key with unrepo_ prefix
async function verifyApiKey(apiKey: string) {
  // Validate unrepo_chatbot_ prefix
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

  // Check if user is premium (has paid or is token holder)
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

    // Rate limit: 200 requests per hour for premium chatbot
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

export async function POST(request: NextRequest) {
  try {
    // Get API key from header
    const apiKey = request.headers.get('x-api-key');
    
    if (!apiKey) {
      return errorResponse('API key is required in x-api-key header', 401);
    }

    // Check if user is premium for higher rate limits
    const isPremiumUser = await checkPremiumRateLimit(apiKey);
    const rateLimitConfig = isPremiumUser ? RATE_LIMITS.premium : RATE_LIMITS.chatbot;

    // Apply rate limiting
    const rateLimitResult = await rateLimit(request, rateLimitConfig);
    
    if (!rateLimitResult.allowed) {
      return rateLimitResult.error!;
    }

    // Verify API key
    const key = await verifyApiKey(apiKey);

    // Get request body
    const { message, repoUrl, repoContext = {}, conversationHistory = [] } = await request.json();

    if (!message) {
      return errorResponse('Message is required');
    }

    // Build conversation context
    const messages = [
      ...conversationHistory,
      { role: 'user', content: message }
    ];

    // Call AI with repository context
    const response = await chatWithRepository(
      messages,
      {
        repoUrl: repoUrl || '',
        repoOwner: repoContext.owner || '',
        repoName: repoContext.name || '',
        files: repoContext.files || [],
      }
    );

    // Log API usage
    await prisma.apiUsage.create({
      data: {
        userId: key.userId,
        apiKeyId: key.id,
        endpoint: '/api/v1/chatbot',
        method: 'POST',
        requestData: JSON.stringify({ message, repoUrl }),
      },
    });

    // Save chat message to database
    await prisma.chatMessage.createMany({
      data: [
        {
          userId: key.userId,
          sessionId: `api_${key.id}_${Date.now()}`,
          role: 'user',
          content: message,
          repoContext: repoUrl,
        },
        {
          userId: key.userId,
          sessionId: `api_${key.id}_${Date.now()}`,
          role: 'assistant',
          content: response,
          repoContext: repoUrl,
        },
      ],
    });

    const apiResponse = successResponse({
      response,
      message,
      repoUrl,
      aiProvider: response.includes('🤖') ? 'intelligent-routing' : 'default',
    });
    
    // Add rate limit headers
    const isPremiumForHeaders = await checkPremiumRateLimit(apiKey!);
    const limit = isPremiumForHeaders ? RATE_LIMITS.premium.maxRequests : RATE_LIMITS.chatbot.maxRequests;
    addRateLimitHeaders(apiResponse, limit, rateLimitResult.remaining, rateLimitResult.resetAt);
    
    // Add CORS headers
    Object.entries(corsHeaders).forEach(([key, value]) => {
      apiResponse.headers.set(key, value);
    });
    
    return apiResponse;
  } catch (error: any) {
    console.error('Chatbot API v1 error:', error);
    const apiResponse = errorResponse(
      error.message || 'Chat request failed',
      error.message.includes('Rate limit') ? 429 : 500
    );
    
    // Add CORS headers
    Object.entries(corsHeaders).forEach(([key, value]) => {
      apiResponse.headers.set(key, value);
    });
    
    return apiResponse;
  }
}
