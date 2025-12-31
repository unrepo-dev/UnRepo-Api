import { NextRequest } from 'next/server';
import { prisma } from './prisma';
import { errorResponse } from './validation';

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  message?: string;
}

/**
 * Rate limiting middleware for API endpoints
 * Uses database to track request counts per API key
 */
export async function rateLimit(
  request: NextRequest,
  config: RateLimitConfig = { maxRequests: 100, windowMs: 60 * 60 * 1000 }
): Promise<{ allowed: boolean; remaining: number; resetAt: Date; error?: Response }> {
  try {
    const apiKey = request.headers.get('x-api-key');
    
    if (!apiKey) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(),
        error: errorResponse('API key is required', 401),
      };
    }

    // Find API key in database
    const key = await prisma.apiKey.findFirst({
      where: {
        key: apiKey,
        isActive: true,
      },
    });

    if (!key) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(),
        error: errorResponse('Invalid or inactive API key', 401),
      };
    }

    // Calculate time window
    const now = new Date();
    const windowStart = new Date(now.getTime() - config.windowMs);

    // Count requests in current window
    const requestCount = await prisma.apiUsage.count({
      where: {
        apiKeyId: key.id,
        createdAt: { gte: windowStart },
      },
    });

    // Check if rate limit exceeded
    if (requestCount >= config.maxRequests) {
      const resetAt = new Date(windowStart.getTime() + config.windowMs);
      
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        error: errorResponse(
          config.message || `Rate limit exceeded. Maximum ${config.maxRequests} requests per ${config.windowMs / 1000 / 60} minutes. Try again at ${resetAt.toISOString()}`,
          429
        ),
      };
    }

    // Calculate reset time (end of current window)
    const resetAt = new Date(windowStart.getTime() + config.windowMs);
    const remaining = config.maxRequests - requestCount;

    return {
      allowed: true,
      remaining,
      resetAt,
    };
  } catch (error: any) {
    console.error('Rate limit check error:', error);
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(),
      error: errorResponse('Rate limit check failed', 500),
    };
  }
}

/**
 * Rate limit configurations for different API endpoints
 */
export const RATE_LIMITS = {
  // Research API: 100 requests per hour
  research: {
    maxRequests: 100,
    windowMs: 60 * 60 * 1000, // 1 hour
    message: 'Research API rate limit exceeded. Maximum 100 requests per hour.',
  },
  
  // Chatbot API: 200 requests per hour
  chatbot: {
    maxRequests: 200,
    windowMs: 60 * 60 * 1000, // 1 hour
    message: 'Chatbot API rate limit exceeded. Maximum 200 requests per hour.',
  },
  
  // API key generation: 5 per day
  keyGeneration: {
    maxRequests: 5,
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    message: 'API key generation rate limit exceeded. Maximum 5 keys per day.',
  },
  
  // Premium tier (token holders): 500 requests per hour
  premium: {
    maxRequests: 500,
    windowMs: 60 * 60 * 1000, // 1 hour
    message: 'Premium API rate limit exceeded. Maximum 500 requests per hour.',
  },
};

/**
 * Check if user is premium (token holder) and apply premium rate limits
 */
export async function checkPremiumRateLimit(apiKey: string): Promise<boolean> {
  try {
    const key = await prisma.apiKey.findFirst({
      where: {
        key: apiKey,
        isActive: true,
      },
      include: {
        user: true,
      },
    });

    return key?.user?.isTokenHolder || false;
  } catch (error) {
    console.error('Premium check error:', error);
    return false;
  }
}

/**
 * Add rate limit headers to response
 */
export function addRateLimitHeaders(
  response: Response,
  limit: number,
  remaining: number,
  resetAt: Date
): Response {
  response.headers.set('X-RateLimit-Limit', limit.toString());
  response.headers.set('X-RateLimit-Remaining', remaining.toString());
  response.headers.set('X-RateLimit-Reset', Math.floor(resetAt.getTime() / 1000).toString());
  
  return response;
}
