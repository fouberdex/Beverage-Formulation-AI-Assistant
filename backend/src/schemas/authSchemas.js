import { z } from 'zod';

export const updateProfileSchema = z.object({
  display_name: z.string().trim().min(1).max(100),
});
