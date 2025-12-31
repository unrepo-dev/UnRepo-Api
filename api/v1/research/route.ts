import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import GitHubService from '@/lib/github';
import { analyzeRepositoryWithClaude } from '@/lib/ai';
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
  // Validate unrepo_research_ prefix
  if (!apiKey.startsWith('unrepo_research_')) {
    throw new Error('Invalid API key format. Research API keys must start with unrepo_research_');
  }

  const key = await prisma.apiKey.findFirst({
    where: {
      key: apiKey,
      type: 'RESEARCH',
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

  // PREMIUM: Rate limit check (100 per hour)
  if (isPremium) {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    const recentUsage = await prisma.apiUsage.count({
      where: {
        apiKeyId: key.id,
        createdAt: { gte: oneHourAgo },
      },
    });

    // Rate limit: 100 requests per hour for premium research
    if (recentUsage >= 100) {
      throw new Error('Rate limit exceeded. Maximum 100 requests per hour.');
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
    const rateLimitConfig = isPremiumUser ? RATE_LIMITS.premium : RATE_LIMITS.research;

    // Apply rate limiting
    const rateLimitResult = await rateLimit(request, rateLimitConfig);
    
    if (!rateLimitResult.allowed) {
      return rateLimitResult.error!;
    }

    // Verify API key
    const key = await verifyApiKey(apiKey);

    // Get request body
    const { repoUrl, options = {} } = await request.json();

    if (!repoUrl) {
      return errorResponse('Repository URL is required');
    }

    // Parse and fetch repository
    const githubService = new GitHubService();
    const parsed = githubService.parseRepoUrl(repoUrl);

    if (!parsed) {
      return errorResponse('Invalid GitHub URL format');
    }

    const { owner, repo } = parsed;

    // Fetch repository data
    const repoData = await githubService.getRepository(owner, repo);
    
    // Fetch file tree and languages in parallel
    const [fileTree, languages] = await Promise.all([
      githubService.getFileTree(owner, repo, repoData.branch),
      githubService.getLanguages(owner, repo),
    ]);

    // Get sample files for analysis
    const sampleFiles = await githubService.getMultipleFiles(
      owner,
      repo,
      ['README.md', 'package.json', 'Cargo.toml', 'go.mod', 'requirements.txt', 'setup.py'],
      repoData.branch
    );

    // Run AI analysis
    let analysis = null;
    if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
      try {
        analysis = await analyzeRepositoryWithClaude({
          repoUrl,
          repoOwner: owner,
          repoName: repo,
          files: sampleFiles,
          structure: fileTree,
        });
      } catch (error: any) {
        console.error('AI analysis failed:', error.message);
      }
    }

    // Log API usage
    await prisma.apiUsage.create({
      data: {
        userId: key.userId,
        apiKeyId: key.id,
        endpoint: '/api/v1/research',
        method: 'POST',
        requestData: JSON.stringify({ repoUrl, options }),
      },
    });

    // Save analysis to database
    await prisma.repositoryAnalysis.create({
      data: {
        userId: key.userId,
        repoUrl,
        repoOwner: owner,
        repoName: repo,
        repoBranch: repoData.branch || 'main',
        languages: JSON.stringify(languages),
        structure: JSON.stringify(fileTree),
        codeQuality: analysis?.codeQuality || null,
        rugPotential: analysis?.rugPotential || null,
        aiGenerated: analysis?.aiGenerated || null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    const response = successResponse({
      repository: {
        owner: repoData.owner,
        name: repoData.name,
        url: repoData.url,
        description: repoData.description,
        language: repoData.language,
        stars: repoData.stars,
        forks: repoData.forks,
        branch: repoData.branch,
      },
      languages,
      analysis: analysis || {
        message: 'AI analysis unavailable - configure API keys',
      },
      rugPotential: analysis?.rugPotential || null,
      codeQuality: analysis?.codeQuality || null,
      aiGenerated: analysis?.aiGenerated || null,
    });
    
    // Add rate limit headers
    const isPremiumForHeaders = await checkPremiumRateLimit(apiKey!);
    const limit = isPremiumForHeaders ? RATE_LIMITS.premium.maxRequests : RATE_LIMITS.research.maxRequests;
    addRateLimitHeaders(response, limit, rateLimitResult.remaining, rateLimitResult.resetAt);
    
    // Add CORS headers
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    
    return response;
  } catch (error: any) {
    console.error('Research API v1 error:', error);
    const response = errorResponse(
      error.message || 'Repository analysis failed', 
      error.message.includes('Rate limit') ? 429 : 500
    );
    
    // Add CORS headers
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    
    return response;
  }
}
