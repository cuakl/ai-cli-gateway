import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { EmptyState } from '../EmptyState.js';
import { MessageSquareIcon } from '../icons.js';
import { Markdown } from './markdown.js';
import {
  groupToolBlocks,
  type AssistantItem,
  type ChangedFile,
  type NoticeItem,
  type TurnItem,
  type UserItem,
} from './model.js';
import { RunFooter } from './RunFooter.js';
import { ToolRow } from './ToolRow.js';

export interface TranscriptProps {
  items: readonly TurnItem[];
  emptyTitle: string;
  emptyHint: string;
  onReview: () => void;
  onUndo: (runId: string) => void;
  onKeepGoing: () => void;
  onNoticeAction: (item: NoticeItem, action: string) => void;
}

const NEAR_BOTTOM_PX = 48;

export function Transcript({
  items,
  emptyTitle,
  emptyHint,
  onReview,
  onUndo,
  onKeepGoing,
  onNoticeAction,
}: TranscriptProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const live = liveAgentStatus(items);

  useLayoutEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    if (stickRef.current) {
      node.scrollTop = node.scrollHeight;
      setShowJump(false);
      return;
    }
    setShowJump(!isNearBottom(node));
  }, [items]);

  function onScroll(): void {
    const node = scrollerRef.current;
    if (!node) return;
    const near = isNearBottom(node);
    stickRef.current = near;
    setShowJump(!near);
  }

  function jumpToLatest(): void {
    const node = scrollerRef.current;
    stickRef.current = true;
    if (node) node.scrollTop = node.scrollHeight;
    setShowJump(false);
  }

  return (
    <div className="transcript">
      <div className="messages" ref={scrollerRef} onScroll={onScroll}>
        {items.length === 0 ? (
          <EmptyState icon={<MessageSquareIcon size={24} />} title={emptyTitle} hint={emptyHint} />
        ) : (
          items.map((item) => {
            if (item.kind === 'user') return <UserBubble key={item.id} item={item} />;
            if (item.kind === 'notice') {
              return <NoticeCard key={item.id} item={item} onAction={onNoticeAction} />;
            }
            return (
              <AssistantTurn
                key={item.id}
                item={item}
                onReview={onReview}
                onUndo={onUndo}
                onKeepGoing={onKeepGoing}
              />
            );
          })
        )}
      </div>
      {showJump ? (
        <button type="button" className="jump-latest" data-action="jump-latest" onClick={jumpToLatest}>
          Jump to latest
        </button>
      ) : null}
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {live}
      </p>
    </div>
  );
}

function UserBubble({ item }: { item: UserItem }) {
  return (
    <div className="message user" data-kind="user">
      <p className="user-text">{item.text}</p>
      {item.chips.length > 0 ? (
        <div className="user-chips">
          {item.chips.map((chip) => (
            <span key={chip.id} className="chip">
              {chip.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AssistantTurn({
  item,
  onReview,
  onUndo,
  onKeepGoing,
}: {
  item: AssistantItem;
  onReview: () => void;
  onUndo: (runId: string) => void;
  onKeepGoing: () => void;
}) {
  return (
    <div className="assistant-item" data-kind="assistant">
      {groupToolBlocks(item.blocks).map((entry, index) => {
        if (entry.kind === 'read-group') {
          return (
            <ToolRow
              key={`read-${index}`}
              label={entry.label}
              name="Read"
              state="ok"
              tools={entry.blocks}
            />
          );
        }
        const block = entry.block;
        if (block.kind === 'markdown') {
          return <Markdown key={`md-${index}`} text={block.text} />;
        }
        if (block.kind === 'tool') {
          return (
            <ToolRow
              key={block.toolCallId}
              label={block.label}
              name={block.name}
              state={block.state}
              args={block.args}
              result={block.result}
            />
          );
        }
        return <FilesList key={`files-${index}`} files={block.files} />;
      })}
      <RunFooter item={item} onReview={onReview} onUndo={onUndo} onKeepGoing={onKeepGoing} />
    </div>
  );
}

function FilesList({ files }: { files: readonly ChangedFile[] }) {
  return (
    <ul className="files-block">
      {files.map((file) => (
        <li key={file.path}>
          <span className="files-path">{file.path}</span>
          {file.additions || file.deletions ? (
            <>
              <span className="files-add">+{file.additions}</span>
              <span className="files-del">−{file.deletions}</span>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function NoticeCard({
  item,
  onAction,
}: {
  item: NoticeItem;
  onAction: (item: NoticeItem, action: string) => void;
}) {
  return (
    <div className={`chat-notice chat-notice-${item.tone}`} data-tone={item.tone} role="note">
      <p className="chat-notice-text">{item.text}</p>
      {item.setup && item.setup.length > 0 ? (
        <ol className="chat-notice-setup">
          {item.setup.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {item.actions && item.actions.length > 0 ? (
        <div className="chat-notice-actions">
          {item.actions.map((action) => (
            <button
              key={action.action}
              type="button"
              className="ghost"
              data-action={action.action}
              onClick={() => onAction(item, action.action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function liveAgentStatus(items: readonly TurnItem[]): string {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind !== 'assistant') continue;
    if (item.status !== 'running' && item.status !== 'queued') return '';
    for (let blockIndex = item.blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = item.blocks[blockIndex];
      if (block?.kind === 'tool' && block.state === 'running') {
        return `Agent is ${progressiveVerb(block.label, block.target)}…`;
      }
    }
    return 'Agent is thinking…';
  }
  return '';
}

function progressiveVerb(label: string, target?: string): string {
  const file = basename(stripTicks(target ?? captureTick(label) ?? ''));
  const lower = label.toLowerCase();
  if (lower.startsWith('edited')) return file ? `editing ${file}` : 'editing';
  if (lower.startsWith('read')) return file ? `reading ${file}` : 'reading';
  if (lower.startsWith('ran')) return file ? `running ${file}` : 'running';
  if (lower.startsWith('searched')) return file ? `searching ${file}` : 'searching';
  return file || stripTicks(label);
}

function captureTick(label: string): string | undefined {
  const match = /`([^`]+)`/.exec(label);
  return match?.[1];
}

function stripTicks(value: string): string {
  return value.replace(/`/g, '');
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function isNearBottom(node: HTMLElement): boolean {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= NEAR_BOTTOM_PX;
}
