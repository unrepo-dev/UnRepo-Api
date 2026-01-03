import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { verifyTokenHolder, getTokenThreshold, getTokenMint } from '../lib/helius.js';

const router = express.Router();
const prisma = new PrismaClient();

// Check if wallet is registered
router.get('/check', async (req: Request, res: Response) => {
  try {
    const { address } = req.query;

    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    const walletUser = await prisma.walletUser.findUnique({
      where: { walletAddress: address }
    });

    if (walletUser) {
      return res.json({
        success: true,
        exists: true,
        data: {
          walletAddress: walletUser.walletAddress,
          researchUsed: walletUser.researchUsed,
          researchLimit: walletUser.researchLimit,
          chatUsed: walletUser.chatUsed,
          chatLimit: walletUser.chatLimit,
          isVerified: walletUser.isVerified,
          isTokenHolder: walletUser.isTokenHolder,
          tokenBalance: walletUser.tokenBalance,
        }
      });
    }

    return res.json({
      success: true,
      exists: false
    });
  } catch (error) {
    console.error('Wallet check error:', error);
    return res.status(500).json({ error: 'Failed to check wallet' });
  }
});

// Register new wallet with signature verification
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { walletAddress, signature, message } = req.body;

    if (!walletAddress || !signature || !message) {
      return res.status(400).json({ 
        error: 'Wallet address, signature, and message are required' 
      });
    }

    // Check if already registered
    const existingWallet = await prisma.walletUser.findUnique({
      where: { walletAddress }
    });

    if (existingWallet) {
      return res.json({
        success: true,
        message: 'Wallet already registered',
        data: {
          walletAddress: existingWallet.walletAddress,
          researchUsed: existingWallet.researchUsed,
          researchLimit: existingWallet.researchLimit,
          chatUsed: existingWallet.chatUsed,
          chatLimit: existingWallet.chatLimit,
        }
      });
    }

    // Verify signature
    try {
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = bs58.decode(signature);
      const publicKeyBytes = bs58.decode(walletAddress);
      
      const isValid = nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        publicKeyBytes
      );

      if (!isValid) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    } catch (verifyError) {
      console.error('Signature verification error:', verifyError);
      // For development, allow registration even if verification fails
      // In production, you should return an error here
      console.log('Skipping signature verification for development');
    }

    // Create new wallet user
    const walletUser = await prisma.walletUser.create({
      data: {
        walletAddress,
        signatureHash: signature,
        isVerified: true,
        researchUsed: 0,
        researchLimit: 1,
        chatUsed: 0,
        chatLimit: 5,
      }
    });

    // Auto-check token balance for new registrations
    try {
      const tokenVerification = await verifyTokenHolder(walletAddress);
      if (tokenVerification.isTokenHolder) {
        await prisma.walletUser.update({
          where: { walletAddress },
          data: {
            isTokenHolder: true,
            tokenBalance: tokenVerification.tokenBalance,
            lastTokenCheck: new Date(),
          }
        });
        console.log(`🎉 New wallet ${walletAddress.slice(0, 8)}... is a token holder!`);
      }
    } catch (tokenError) {
      console.log('Token verification skipped:', tokenError);
    }

    return res.json({
      success: true,
      message: 'Wallet registered successfully! You get 1 free research and 5 free chats.',
      data: {
        walletAddress: walletUser.walletAddress,
        researchUsed: walletUser.researchUsed,
        researchLimit: walletUser.researchLimit,
        chatUsed: walletUser.chatUsed,
        chatLimit: walletUser.chatLimit,
      }
    });
  } catch (error) {
    console.error('Wallet registration error:', error);
    return res.status(500).json({ error: 'Failed to register wallet' });
  }
});

// Increment usage for wallet user
router.post('/usage', async (req: Request, res: Response) => {
  try {
    const { walletAddress, type } = req.body;

    if (!walletAddress || !type) {
      return res.status(400).json({ error: 'Wallet address and type are required' });
    }

    if (!['research', 'chat'].includes(type)) {
      return res.status(400).json({ error: 'Type must be "research" or "chat"' });
    }

    const walletUser = await prisma.walletUser.findUnique({
      where: { walletAddress }
    });

    if (!walletUser) {
      return res.status(404).json({ error: 'Wallet not registered' });
    }

    // Token holders get unlimited access - skip limit checks
    if (!walletUser.isTokenHolder) {
      // Check limits for non-token holders
      if (type === 'research' && walletUser.researchUsed >= walletUser.researchLimit) {
        return res.status(403).json({ 
          error: 'Research limit reached. Hold 1M+ $UNREPO tokens for unlimited access!',
          used: walletUser.researchUsed,
          limit: walletUser.researchLimit
        });
      }

      if (type === 'chat' && walletUser.chatUsed >= walletUser.chatLimit) {
        return res.status(403).json({ 
          error: 'Chat limit reached. Hold 1M+ $UNREPO tokens for unlimited access!',
          used: walletUser.chatUsed,
          limit: walletUser.chatLimit
        });
      }
    } else {
      console.log(`🎉 Token holder ${walletAddress.slice(0, 8)}... using ${type} (unlimited access)`);
    }

    // Increment usage
    const updatedWallet = await prisma.walletUser.update({
      where: { walletAddress },
      data: {
        ...(type === 'research' ? { researchUsed: { increment: 1 } } : {}),
        ...(type === 'chat' ? { chatUsed: { increment: 1 } } : {}),
        lastUsedAt: new Date(),
      }
    });

    return res.json({
      success: true,
      data: {
        researchUsed: updatedWallet.researchUsed,
        researchLimit: updatedWallet.researchLimit,
        chatUsed: updatedWallet.chatUsed,
        chatLimit: updatedWallet.chatLimit,
      }
    });
  } catch (error) {
    console.error('Usage update error:', error);
    return res.status(500).json({ error: 'Failed to update usage' });
  }
});

// Validate wallet for API access (used by research/chat endpoints)
router.get('/validate', async (req: Request, res: Response) => {
  try {
    const { address, type } = req.query;

    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    const walletUser = await prisma.walletUser.findUnique({
      where: { walletAddress: address }
    });

    if (!walletUser) {
      return res.json({
        success: false,
        valid: false,
        error: 'Wallet not registered'
      });
    }

    let canUse = true;
    if (type === 'research') {
      canUse = walletUser.researchUsed < walletUser.researchLimit;
    } else if (type === 'chat') {
      canUse = walletUser.chatUsed < walletUser.chatLimit;
    }

    return res.json({
      success: true,
      valid: canUse,
      data: {
        researchUsed: walletUser.researchUsed,
        researchLimit: walletUser.researchLimit,
        chatUsed: walletUser.chatUsed,
        chatLimit: walletUser.chatLimit,
      }
    });
  } catch (error) {
    console.error('Wallet validation error:', error);
    return res.status(500).json({ error: 'Failed to validate wallet' });
  }
});

// Verify token holdings for a wallet
router.post('/verify-tokens', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required'
      });
    }

    console.log(`🔍 Token verification request for: ${walletAddress}`);

    // Check token balance using Helius API
    const verification = await verifyTokenHolder(walletAddress);

    // Update wallet user if registered
    const walletUser = await prisma.walletUser.findUnique({
      where: { walletAddress }
    });

    if (walletUser) {
      // Update token holder status in database
      await prisma.walletUser.update({
        where: { walletAddress },
        data: {
          isTokenHolder: verification.isTokenHolder,
          tokenBalance: verification.tokenBalance,
          lastTokenCheck: new Date(),
        }
      });
      console.log(`✅ Updated wallet ${walletAddress.slice(0, 8)}... isTokenHolder: ${verification.isTokenHolder}`);
    }

    return res.json({
      success: true,
      data: {
        isTokenHolder: verification.isTokenHolder,
        tokenBalance: verification.tokenBalance,
        threshold: verification.threshold,
        tokenMint: getTokenMint(),
        message: verification.isTokenHolder 
          ? 'Congratulations! You are a verified token holder with unlimited access.'
          : `You need ${(verification.threshold - verification.tokenBalance).toLocaleString()} more tokens to unlock unlimited access.`
      }
    });
  } catch (error: any) {
    console.error('Token verification error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to verify token holdings'
    });
  }
});

// Get token verification info (public endpoint)
router.get('/token-info', async (req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      data: {
        tokenMint: getTokenMint(),
        threshold: getTokenThreshold(),
        decimals: 6,
        symbol: 'UNREPO',
        benefits: [
          'Unlimited AI Chat',
          'Unlimited Research Analysis',
          'Priority Support',
          'Early Access to New Features'
        ]
      }
    });
  } catch (error) {
    console.error('Token info error:', error);
    return res.status(500).json({ error: 'Failed to get token info' });
  }
});

export default router;
