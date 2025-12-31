import { z } from 'zod';

// Schema for GitHub repository URL validation
export const repoUrlSchema = z.object({
  url: z.string().url().refine(
    (url) => {
      return url.includes('github.com');
    },
    { message: 'Must be a valid GitHub repository URL' }
  ),
});

// Schema for chat message
export const chatMessageSchema = z.object({
  message: z.string().min(1).max(2000),
  sessionId: z.string().uuid(),
  repoUrl: z.string().url().optional(),
});

// Schema for wallet verification
export const walletVerificationSchema = z.object({
  walletAddress: z.string().min(32).max(44),
  transactionSignature: z.string().optional(),
});

// Schema for API key creation
export const apiKeyCreateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(['RESEARCH', 'CHATBOT']),
  expiresInDays: z.number().min(1).max(365).optional(),
});

// Schema for repository analysis
export const repoAnalysisSchema = z.object({
  repoUrl: z.string().url(),
  branch: z.string().optional().default('main'),
  forceRefresh: z.boolean().optional().default(false),
});

// Validate environment variables
export function validateEnv() {
  const requiredEnvVars = [
    'DATABASE_URL',
    'NEXT_PUBLIC_PRIVY_APP_ID',
    'REDIS_URL',
  ];

  const missing = requiredEnvVars.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
}

// Sanitize file path to prevent directory traversal
export function sanitizeFilePath(path: string): string {
  return path.replace(/\.\./g, '').replace(/^\//, '');
}

// Validate Solana address format
export function isValidSolanaAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

// Rate limit key generators
export const rateLimitKeys = {
  chat: (userId: string, sessionId: string) => `rate:chat:${userId}:${sessionId}`,
  api: (keyId: string) => `rate:api:${keyId}`,
  user: (userId: string) => `rate:user:${userId}`,
};

// Error response helper
export function errorResponse(message: string, status: number = 400) {
  return Response.json({ success: false, error: message }, { status });
}

// Success response helper
export function successResponse<T>(data: T, message?: string) {
  return Response.json({ success: true, data, message }, { status: 200 });
}

export default {
  repoUrlSchema,
  chatMessageSchema,
  walletVerificationSchema,
  apiKeyCreateSchema,
  repoAnalysisSchema,
  validateEnv,
  sanitizeFilePath,
  isValidSolanaAddress,
  rateLimitKeys,
  errorResponse,
  successResponse,
};
