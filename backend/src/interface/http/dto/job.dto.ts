import { z } from 'zod';

export const requestImprovementSchema = z.object({
  repositoryId: z.string().trim().min(1).max(100),
  filePath: z.string().trim().min(1).max(500),
});
export type RequestImprovementDto = z.infer<typeof requestImprovementSchema>;
