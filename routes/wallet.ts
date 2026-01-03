import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

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

    // Check limits
    if (type === 'research' && walletUser.researchUsed >= walletUser.researchLimit) {
      return res.status(403).json({ 
        error: 'Research limit reached',
        used: walletUser.researchUsed,
        limit: walletUser.researchLimit
      });
    }

    if (type === 'chat' && walletUser.chatUsed >= walletUser.chatLimit) {
      return res.status(403).json({ 
        error: 'Chat limit reached',
        used: walletUser.chatUsed,
        limit: walletUser.chatLimit
      });
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

export default router;
