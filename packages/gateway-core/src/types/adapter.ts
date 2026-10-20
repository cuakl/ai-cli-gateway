import type { PromptOptions, ProviderType, UnifiedStreamEvent } from '@gateway/shared-types';

export interface ExecuteResult {
  exitCode: number;
  summary: string;
}

export interface CLIAdapter {
  readonly provider: ProviderType;
  isAvailable(): Promise<boolean>;
  getBinaryPath(): Promise<string>;
  execute(
    options: PromptOptions,
    onEvent: (event: UnifiedStreamEvent) => void,
  ): Promise<ExecuteResult>;
  kill(sessionId: string): Promise<boolean>;
}
