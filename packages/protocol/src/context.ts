import { z } from 'zod';

export const ComponentLocationSchema = z.object({
  componentName: z.string(),
  fileName: z.string(),
  lineNumber: z.number().int().nonnegative(),
  columnNumber: z.number().int().nonnegative(),
  props: z.record(z.string(), z.unknown()),
});

export type ComponentLocation = z.infer<typeof ComponentLocationSchema>;

export const SelectedElementSchema = z.object({
  tagName: z.string(),
  id: z.string(),
  className: z.string(),
  outerHTML: z.string(),
  computedStyles: z.record(z.string(), z.string()),
  sourceLocation: ComponentLocationSchema.optional(),
});

export type SelectedElement = z.infer<typeof SelectedElementSchema>;

export const FrontendErrorSchema = z.object({
  type: z.enum(['runtime', 'unhandled_rejection', 'console_error', 'vite']),
  message: z.string(),
  stack: z.string().optional(),
  timestamp: z.number(),
});

export type FrontendError = z.infer<typeof FrontendErrorSchema>;

export const FrontendConsoleLogSchema = z.object({
  level: z.enum(['log', 'warn', 'error']),
  args: z.array(z.string()),
  timestamp: z.number(),
});

export type FrontendConsoleLog = z.infer<typeof FrontendConsoleLogSchema>;

export const FailedNetworkRequestSchema = z.object({
  url: z.string(),
  status: z.number().int(),
  durationMs: z.number().nonnegative(),
  method: z.string().optional(),
  bodyPreview: z.string().optional(),
});

export type FailedNetworkRequest = z.infer<typeof FailedNetworkRequestSchema>;

export const FrontendContextPayloadSchema = z.object({
  selectedElement: SelectedElementSchema.optional(),
  selectedElements: z.array(SelectedElementSchema).max(5).optional(),
  screenshotBase64: z.string().optional(),
  recentErrors: z.array(FrontendErrorSchema).default([]),
  recentConsoleLogs: z.array(FrontendConsoleLogSchema).default([]),
  failedNetworkRequests: z.array(FailedNetworkRequestSchema).default([]),
});

export type FrontendContextPayload = z.infer<typeof FrontendContextPayloadSchema>;
