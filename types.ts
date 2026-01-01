// Type definitions for UnRepo API

export interface FileNode {
  path: string;
  type: 'file' | 'dir' | 'tree' | 'blob' | 'directory';
  name?: string;
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
  fullName: string;
  description?: string;
  stars: number;
  forks: number;
  language?: string;
  branch: string;
  url: string;
}
