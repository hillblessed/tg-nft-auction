import { Router, Request, Response } from 'express';
import { User } from '../models';

export const createUserRoutes = (): Router => {
  const router = Router();

  // Get user balance
  router.get('/:id/balance', async (req: Request, res: Response) => {
    try {
      const user = await User.findById(req.params.id);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      return res.json({
        success: true,
        data: {
          userId: user._id,
          balance: user.balance,
          frozenFunds: user.frozenFunds,
          availableBalance: user.balance - user.frozenFunds,
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'Failed to get user balance',
      });
    }
  });

  // Get all users (for testing/demo)
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const users = await User.find({}).select('_id balance frozenFunds').limit(20);
      
      return res.json({
        success: true,
        data: users.map(u => ({
          userId: u._id,
          balance: u.balance,
          frozenFunds: u.frozenFunds,
          availableBalance: u.balance - u.frozenFunds,
        })),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'Failed to get users',
      });
    }
  });

  return router;
};
