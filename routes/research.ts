import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import GitHubService from '../lib/github.js';
import { analyzeRepositoryWithClaude } from '../lib/ai.js';

const router = Router();
const prisma = new PrismaClient();

// Verify API key with unrepo_research_ prefix
async function verifyApiKey(apiKey: string) {
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

// POST /api/v1/research
router.post('/', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'] as string;
    
    if (!apiKey) {
      return res.status(401).json({ error: 'API key is required in x-api-key header' });
    }

    // Verify API key
    const key = await verifyApiKey(apiKey);

    // Get request body
    const { repoUrl, options = {} } = req.body;

    if (!repoUrl) {
      return res.status(400).json({ error: 'Repository URL is required' });
    }

    // Parse and fetch repository
    const githubService = new GitHubService();
    const parsed = githubService.parseRepoUrl(repoUrl);

    if (!parsed) {
      return res.status(400).json({ error: 'Invalid GitHub URL format' });
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
        console.error('AI analysis failed:', error);
        analysis = `AI analysis unavailable: ${error.message}`;
      }
    }

    // Log API usage
    await prisma.apiUsage.create({
      data: {
        userId: key.userId,
        apiKeyId: key.id,
        endpoint: '/api/v1/research',
        method: 'POST',
        requestData: JSON.stringify({ repoUrl }),
      },
    });

    // Build response
    const response = {
      success: true,
      data: {
        repository: {
          owner,
          name: repo,
          url: repoUrl,
          description: repoData.description,
          stars: repoData.stars,
          forks: repoData.forks,
          language: repoData.language,
          branch: repoData.branch,
        },
        languages,
        fileTree: Array.isArray(fileTree) ? fileTree.slice(0, 100) : [], // Limit to 100 files
        files: sampleFiles,
        analysis: analysis || 'AI analysis not available',
      },
      usage: {
        count: key.usageCount + 1,
        limit: key.user.paymentVerified || key.user.isTokenHolder ? null : 5
      }
    };

    res.json(response);
  } catch (error: any) {
    console.error('Research API error:', error);
    
    if (error.message.includes('limit') || error.message.includes('Invalid')) {
      return res.status(429).json({ error: error.message });
    }
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Repository not found' });
    }
    
    res.status(500).json({ error: 'Failed to process request' });
  }
});

export default router;
