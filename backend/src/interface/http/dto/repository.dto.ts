import { z } from 'zod';

export const registerRepositorySchema = z.object({
  url: z.string().trim().min(1).max(300),
});
export type RegisterRepositoryDto = z.infer<typeof registerRepositorySchema>;

export const listFilesQuerySchema = z.object({
  belowThreshold: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
export type ListFilesQueryDto = z.infer<typeof listFilesQuerySchema>;
