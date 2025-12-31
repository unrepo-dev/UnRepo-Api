// Type definitions for UnRepo API

export interface FileNode {
  path: string;
  type: 'file' | 'dir' | 'tree' | 'blob' | 'directory';
  size?: number;
  sha?: string;
  url?: string;
  children?: FileNode[];
}

export interface GitHubFile {
  path: string;
  content: string;
  size: number;
  encoding?: string;
}

export interface GitHubContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: 'file' | 'dir';
  content?: string;
  encoding?: string;
}

export interface RepositoryData {
  name: string;
  owner: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  branch: string;
  updatedAt: string;
  url: string;
}
