import { Router } from 'express';
import OpenAI from 'openai';

const router = Router();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// GitHub API token (if available)
const GITHUB_TOKEN = process.env.GITHUB_ACCESS_TOKEN;

// Fetch repository data from GitHub
async function fetchRepoData(owner: string, repo: string) {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'UnRepo-Extension'
  };

  if (GITHUB_TOKEN) {
    headers['Authorization'] = `token ${GITHUB_TOKEN}`;
  }

  try {
    // Fetch repository info
    const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    const repoData = await repoResponse.json();

    // Fetch languages
    const languagesResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/languages`, { headers });
    const languages = await languagesResponse.json();

    // Fetch recent commits
    const commitsResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=30`, { headers });
    const commits = await commitsResponse.json();

    // Fetch contributors
    const contributorsResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contributors?per_page=10`, { headers });
    const contributors = await contributorsResponse.json();

    // Fetch README
    let readme = '';
    try {
      const readmeResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers });
      const readmeData = await readmeResponse.json() as any;
      if (readmeData.content) {
        readme = Buffer.from(readmeData.content, 'base64').toString('utf-8');
      }
    } catch (e) {
      readme = 'No README found';
    }

    return {
      repo: repoData,
      languages,
      commits: Array.isArray(commits) ? commits : [],
      contributors: Array.isArray(contributors) ? contributors : [],
      readme: readme.substring(0, 3000) // Limit README length
    };
  } catch (error) {
    console.error('Error fetching repo data:', error);
    throw new Error('Failed to fetch repository data from GitHub');
  }
}

// Analyze repository using OpenAI
async function analyzeWithAI(repoData: any, owner: string, repo: string) {
  const prompt = `You are an expert code analyst. Analyze this GitHub repository and provide a comprehensive assessment.

Repository: ${owner}/${repo}
Created: ${repoData.repo.created_at}
Last Updated: ${repoData.repo.updated_at}
Stars: ${repoData.repo.stargazers_count}
Forks: ${repoData.repo.forks_count}
Open Issues: ${repoData.repo.open_issues_count}
Default Branch: ${repoData.repo.default_branch}
License: ${repoData.repo.license?.name || 'None'}

Languages: ${JSON.stringify(repoData.languages, null, 2)}

Recent Commits (${repoData.commits.length}):
${repoData.commits.slice(0, 10).map((c: any) => `- ${c.commit?.message || 'N/A'} (${c.commit?.author?.date || 'N/A'})`).join('\n')}

Top Contributors (${repoData.contributors.length}):
${repoData.contributors.slice(0, 5).map((c: any) => `- ${c.login} (${c.contributions} contributions)`).join('\n')}

README (first 3000 chars):
${repoData.readme}

Please analyze this repository and provide:

1. **Code Structure Quality** (Score out of 100 and detailed description):
   - Evaluate code organization, readability, dependency structure, and maintenance hygiene
   - Consider language choices, file structure patterns, and architectural decisions
   - Give a score like "85/100" or "Good (78/100)"

2. **AI Code Detection** (Percentage and description):
   - Identify patterns suggesting AI-generated code (generic variable names, boilerplate patterns, lack of edge cases)
   - Look at commit messages for AI tool mentions
   - Provide percentage like "15% AI-generated" or "Low AI involvement (8%)"

3. **Repository Age & History** (Time period and analysis):
   - Analyze creation date, commit frequency, and maintenance consistency
   - Evaluate if it's actively maintained or abandoned
   - Provide format like "2.5 years, actively maintained" or "Established (3 years)"

4. **Trust Score** (Overall score and reasoning):
   - Composite score based on structure, activity, ownership, and risk indicators
   - Consider stars, forks, contributors, license, documentation quality
   - Provide score like "92/100" or "High Trust (88/100)"

5. **Final Verdict** (2-3 sentences):
   - Clear, evidence-based conclusion about reliability and technical health
   - Recommendation for usage (production-ready, needs work, experimental, etc.)

Format your response as JSON with this structure:
{
  "codeStructure": {
    "score": "85/100",
    "description": "Well-organized codebase with clear separation of concerns..."
  },
  "aiDetection": {
    "score": "12% AI-generated",
    "description": "Minimal AI code patterns detected..."
  },
  "repositoryAge": {
    "score": "2.5 years",
    "description": "Established repository with consistent maintenance..."
  },
  "trustScore": {
    "overall": "92/100",
    "description": "High trust repository with strong signals..."
  },
  "verdict": "This repository demonstrates excellent code quality and reliability. The codebase shows professional development practices with consistent maintenance. Highly recommended for production use."
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert code analyst specializing in GitHub repository evaluation. Provide detailed, evidence-based analysis in JSON format.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000,
      response_format: { type: "json_object" }
    });

    const responseText = completion.choices[0].message.content;
    if (!responseText) {
      throw new Error('Empty response from OpenAI');
    }

    return JSON.parse(responseText);
  } catch (error) {
    console.error('OpenAI analysis error:', error);
    throw new Error('Failed to analyze repository with AI');
  }
}

// POST /api/v1/analyze - Analyze a GitHub repository
router.post('/analyze', async (req, res) => {
  try {
    const { owner, repo, fullAnalysis } = req.body;

    if (!owner || !repo) {
      return res.status(400).json({ 
        error: 'Missing required fields: owner and repo' 
      });
    }

    console.log(`Analyzing repository: ${owner}/${repo}`);

    // Fetch repository data from GitHub
    const repoData = await fetchRepoData(owner, repo);

    // Analyze with OpenAI
    const analysis = await analyzeWithAI(repoData, owner, repo);

    // Return analysis results
    res.json({
      success: true,
      repository: `${owner}/${repo}`,
      analyzedAt: new Date().toISOString(),
      ...analysis
    });

  } catch (error: any) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to analyze repository',
      details: error.toString()
    });
  }
});

// GET /api/v1/analyze/:owner/:repo - Alternative endpoint with URL params
router.get('/analyze/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;

    console.log(`Analyzing repository: ${owner}/${repo}`);

    // Fetch repository data from GitHub
    const repoData = await fetchRepoData(owner, repo);

    // Analyze with OpenAI
    const analysis = await analyzeWithAI(repoData, owner, repo);

    // Return analysis results
    res.json({
      success: true,
      repository: `${owner}/${repo}`,
      analyzedAt: new Date().toISOString(),
      ...analysis
    });

  } catch (error: any) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to analyze repository',
      details: error.toString()
    });
  }
});

export default router;
