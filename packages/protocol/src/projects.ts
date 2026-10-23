import { z } from 'zod';

export const ProjectSchema = z.object({
  /** Stable hash of `realpath(root)`. */
  id: z.string().min(1),
  root: z.string().min(1),
  /** `package.json` name, or the directory basename. */
  name: z.string().min(1),
  origins: z.array(z.string().min(1)),
  createdAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
});

export type Project = z.infer<typeof ProjectSchema>;
