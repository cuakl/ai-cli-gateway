import type { Run, ThreadEvent } from '@aidev/protocol';
import { hydrateFromThread, Transcript } from './overlay-chat.js';

export interface ThreadTranscriptProps {
  runs: readonly Run[];
  events: readonly ThreadEvent[];
}

export function ThreadTranscript({ runs, events }: ThreadTranscriptProps) {
  const state = hydrateFromThread(runs, events);
  return (
    <Transcript
      items={state.items}
      emptyTitle="No messages"
      emptyHint="This thread has no stored events yet."
      onReview={() => undefined}
      onUndo={() => undefined}
      onKeepGoing={() => undefined}
      onNoticeAction={() => undefined}
    />
  );
}
