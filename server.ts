import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import session from 'express-session';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'your-secret-key';

// Allowed origins for CORS
const allowedOrigins = [
  'http://localhost:3000',
  'https://app.unrepo.dev',
  'https://dashboard.unrepo.dev',
  'https://www.unrepo.dev',
  process.env.FRONTEND_URL
].filter(Boolean);

// Middleware
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

app.use(express.json());
app.use(session({
  secret: JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Auth middleware
interface AuthRequest extends Request {
  userId?: string;
  user?: any;
}

async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      req.userId = decoded.userId;
      
      // Fetch user from database
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId }
      });

      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      req.user = user;
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  } catch (error) {
    return res.status(500).json({ error: 'Authentication error' });
  }
}

// Generate API key helper
function generateApiKey(type: 'RESEARCH' | 'CHATBOT'): string {
  const prefix = type === 'RESEARCH' ? 'unrepo_research_' : 'unrepo_chatbot_';
  const randomBytes = crypto.randomBytes(32).toString('hex');
  return prefix + randomBytes;
}

// ===== ROUTES =====

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GitHub OAuth login
app.post('/auth/github/login', async (req: Request, res: Response) => {
  try {
    const { githubId, githubUsername, name, email, avatar } = req.body;

    if (!githubId || !githubUsername) {
      return res.status(400).json({ error: 'GitHub ID and username are required' });
    }

    // Upsert user
    const user = await prisma.user.upsert({
      where: { githubId: githubId.toString() },
      update: {
        githubUsername,
        name: name || githubUsername,
        avatar,
        email,
        lastLogin: new Date(),
      },
      create: {
        githubId: githubId.toString(),
        githubUsername,
        name: name || githubUsername,
        avatar,
        email,
        authMethod: 'GITHUB',
      },
    });

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, githubId: user.githubId },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        githubUsername: user.githubUsername,
        isTokenHolder: user.isTokenHolder,
        paymentVerified: user.paymentVerified
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user session
app.get('/auth/session', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    res.json({
      success: true,
      user: req.user
    });
  } catch (error) {
    res.status(500).json({ error: 'Session fetch failed' });
  }
});

// Create API Key (No auth required for easy testing)
app.post('/api/keys/generate', async (req: Request, res: Response) => {
  try {
    const { type, name, email } = req.body;

    if (!type || !['RESEARCH', 'CHATBOT'].includes(type)) {
      return res.status(400).json({ error: 'Invalid API key type. Must be RESEARCH or CHATBOT' });
    }

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'API name is required' });
    }

    // Get or create user by email (defaults to test user if no email provided)
    const userEmail = email || 'test@unrepo.dev';
    
    // Find existing user
    let user = await prisma.user.findFirst({
      where: { email: userEmail },
      select: { id: true, email: true, name: true }
    });

    // Create user if doesn't exist
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: userEmail,
          name: name,
          authMethod: 'GITHUB',
          githubId: `temp_${Date.now()}`,
          githubUsername: userEmail.split('@')[0],
        },
        select: { id: true, email: true, name: true }
      });
    }

    // Generate and save new API key (allow multiple keys per user)
    const apiKey = generateApiKey(type as 'RESEARCH' | 'CHATBOT');

    const newKey = await prisma.apiKey.create({
      data: {
        userId: user.id,
        key: apiKey,
        type,
        name: name.trim(),
        isActive: true,
      },
      select: {
        key: true,
        type: true,
        name: true,
        createdAt: true,
        isActive: true,
        usageCount: true
      }
    });

    res.json({
      success: true,
      message: 'API key created successfully',
      data: {
        apiKey: newKey.key,
        ...newKey
      }
    });
  } catch (error) {
    console.error('API key generation error:', error);
    res.status(500).json({ error: 'Failed to generate API key' });
  }
});

// Get all API keys for user (no-auth version by email)
app.get('/api/keys', async (req: Request, res: Response) => {
  try {
    const email = req.query.email as string;
    
    if (!email) {
      return res.status(400).json({ error: 'Email parameter required' });
    }

    // Find or create user by email
    let user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      return res.json({
        success: true,
        data: []
      });
    }

    const keys = await prisma.apiKey.findMany({
      where: {
        userId: user.id,
        isActive: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const isPremium = user.paymentVerified || user.isTokenHolder;

    const keysWithTier = keys.map(key => ({
      id: key.id,
      name: key.name,
      key: key.key,
      type: key.type,
      usageCount: key.usageCount,
      createdAt: key.createdAt,
      isActive: key.isActive,
      isPremium,
      remainingCalls: isPremium ? null : Math.max(0, 5 - key.usageCount)
    }));

    res.json({
      success: true,
      data: keysWithTier
    });
  } catch (error) {
    console.error('Fetch keys error:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// Get API key usage
// Get usage stats (no-auth version by email)
app.get('/api/keys/usage', async (req: Request, res: Response) => {
  try {
    const email = req.query.email as string;
    
    if (!email) {
      return res.status(400).json({ error: 'Email parameter required' });
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      return res.json({
        success: true,
        data: []
      });
    }

    const keys = await prisma.apiKey.findMany({
      where: {
        userId: user.id,
        isActive: true
      }
    });

    const usage = keys.map(key => ({
      type: key.type,
      usageCount: key.usageCount,
      lastUsed: key.lastUsedAt
    }));

    res.json({
      success: true,
      data: usage
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

// Delete API key
app.delete('/api/keys/:keyId', async (req: Request, res: Response) => {
  try {
    const { keyId } = req.params;
    const email = req.query.email as string;

    if (!keyId) {
      return res.status(400).json({ error: 'Key ID is required' });
    }

    // Find the key
    const key = await prisma.apiKey.findUnique({
      where: { id: keyId },
      include: { user: true }
    });

    if (!key) {
      return res.status(404).json({ error: 'API key not found' });
    }

    // If email provided, verify ownership
    if (email && key.user.email !== email) {
      return res.status(403).json({ error: 'Unauthorized to delete this key' });
    }

    // Delete the key
    await prisma.apiKey.delete({
      where: { id: keyId }
    });

    res.json({
      success: true,
      message: 'API key deleted successfully'
    });
  } catch (error) {
    console.error('Delete key error:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// Import API route handlers
import chatbotRouter from './routes/chatbot.js';
import researchRouter from './routes/research.js';

app.use('/api/v1/chatbot', chatbotRouter);
app.use('/api/v1/research', researchRouter);

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 UnRepo API Server running on port ${PORT}`);
  console.log(`📍 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
  console.log(`🔐 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  await prisma.$disconnect();
  process.exit(0);
});
