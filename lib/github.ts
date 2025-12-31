import { Octokit } from '@octokit/rest';
import type { FileNode, GitHubFile, GitHubContent, RepositoryData } from '@/types';

export class GitHubService {
  private octokit: Octokit;

  constructor(accessToken?: string) {
    this.octokit = new Octokit({
      auth: accessToken || process.env.GITHUB_ACCESS_TOKEN,
    });
  }

  // Parse GitHub URL
  parseRepoUrl(url: string): { owner: string; repo: string } | null {
    const patterns = [
      /github\.com\/([^\/]+)\/([^\/]+)/,
      /^([^\/]+)\/([^\/]+)$/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return {
          owner: match[1],
          repo: match[2].replace(/\.git$/, ''),
        };
      }
    }

    return null;
  }

  // Get repository information
  async getRepository(owner: string, repo: string): Promise<RepositoryData> {
    try {
      const { data } = await this.octokit.repos.get({
        owner,
        repo,
      });

      return {
        owner: data.owner.login,
        name: data.name,
        fullName: data.full_name,
        branch: data.default_branch,
        url: data.html_url,
        description: data.description || undefined,
        language: data.language || undefined,
        stars: data.stargazers_count,
        forks: data.forks_count,
      };
    } catch (error: any) {
      if (error.status === 404) {
        throw new Error('Repository not found');
      }
      throw new Error(`Failed to fetch repository: ${error.message}`);
    }
  }

  // Get repository file tree
  async getFileTree(owner: string, repo: string, branch: string = 'main'): Promise<FileNode> {
    try {
      const { data } = await this.octokit.git.getTree({
        owner,
        repo,
        tree_sha: branch,
        recursive: 'true',
      });

      // Build tree structure
      const root: FileNode = {
        name: repo,
        path: '',
        type: 'directory',
        children: [],
      };

      const pathMap = new Map<string, FileNode>();
      pathMap.set('', root);

      // Sort by path to ensure parents are created first
      const sortedTree = data.tree.sort((a, b) => a.path!.localeCompare(b.path!));

      for (const item of sortedTree) {
        if (!item.path) continue;

        const parts = item.path.split('/');
        const name = parts[parts.length - 1];
        const parentPath = parts.slice(0, -1).join('/');

        const node: FileNode = {
          name,
          path: item.path,
          type: item.type === 'tree' ? 'directory' : 'file',
          size: item.size,
          sha: item.sha,
          children: item.type === 'tree' ? [] : undefined,
        };

        pathMap.set(item.path, node);

        const parent = pathMap.get(parentPath);
        if (parent && parent.children) {
          parent.children.push(node);
        }
      }

      return root;
    } catch (error: any) {
      throw new Error(`Failed to fetch file tree: ${error.message}`);
    }
  }

  // Get file contents
  async getFileContent(owner: string, repo: string, path: string, branch?: string): Promise<string> {
    try {
      const params: any = {
        owner,
        repo,
        path,
      };

      if (branch) {
        params.ref = branch;
      }

      const { data } = await this.octokit.repos.getContent(params);

      if (Array.isArray(data)) {
        throw new Error('Path is a directory, not a file');
      }

      if (!('content' in data)) {
        throw new Error('No content in response');
      }

      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      return content;
    } catch (error: any) {
      throw new Error(`Failed to fetch file content: ${error.message}`);
    }
  }

  // Get multiple files
  async getMultipleFiles(
    owner: string,
    repo: string,
    paths: string[],
    branch?: string
  ): Promise<Array<{ path: string; content: string }>> {
    const results = await Promise.allSettled(
      paths.map(async (path) => ({
        path,
        content: await this.getFileContent(owner, repo, path, branch),
      }))
    );

    return results
      .filter((result): result is PromiseFulfilledResult<{ path: string; content: string }> =>
        result.status === 'fulfilled'
      )
      .map((result) => result.value);
  }

  // Get repository languages
  async getLanguages(owner: string, repo: string): Promise<Record<string, number>> {
    try {
      const { data } = await this.octokit.repos.listLanguages({
        owner,
        repo,
      });

      return data;
    } catch (error: any) {
      throw new Error(`Failed to fetch languages: ${error.message}`);
    }
  }

  // Search code in repository
  async searchCode(owner: string, repo: string, query: string, limit: number = 10) {
    try {
      const { data } = await this.octokit.search.code({
        q: `${query} repo:${owner}/${repo}`,
        per_page: limit,
      });

      return data.items;
    } catch (error: any) {
      throw new Error(`Failed to search code: ${error.message}`);
    }
  }

  // Get recent commits
  async getRecentCommits(owner: string, repo: string, limit: number = 10) {
    try {
      const { data } = await this.octokit.repos.listCommits({
        owner,
        repo,
        per_page: limit,
      });

      return data.map((commit) => ({
        sha: commit.sha,
        message: commit.commit.message,
        author: commit.commit.author?.name,
        date: commit.commit.author?.date,
        url: commit.html_url,
      }));
    } catch (error: any) {
      throw new Error(`Failed to fetch commits: ${error.message}`);
    }
  }

  // Check if repository exists and is accessible
  async checkRepositoryAccess(owner: string, repo: string): Promise<boolean> {
    try {
      await this.octokit.repos.get({ owner, repo });
      return true;
    } catch {
      return false;
    }
  }
}

export default GitHubService;
