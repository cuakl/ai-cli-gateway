import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ProviderType, SelectedElement } from '@gateway/shared-types';
import { gatherContext } from '../context/index.js';
import { locateElement } from '../inspector/locator.js';
import { ElementPicker } from '../inspector/picker.js';
import type { DevtoolsConfig } from '../types.js';
import { ChatDrawer, type ChatLine } from './ChatDrawer.js';
import { GatewayCancelledError, GatewayClient } from './client.js';
import { Toolbar } from './Toolbar.js';

export interface AppProps {
  config: DevtoolsConfig;
}

export function App({ config }: AppProps) {
  const [inspecting, setInspecting] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [status, setStatus] = useState<'connected' | 'idle'>('idle');
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [provider, setProvider] = useState<ProviderType>('antigravity');
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [sending, setSending] = useState(false);
  const elementRef = useRef<Element | null>(null);
  const pickerRef = useRef<ElementPicker | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  const client = useMemo(
    () =>
      config.client ??
      new GatewayClient({
        gatewayUrl: config.gatewayUrl,
        cwd: config.cwd,
        transport: config.transport,
      }),
    [config.client, config.cwd, config.gatewayUrl, config.transport],
  );

  useLayoutEffect(() => {
    const picker = new ElementPicker({
      onSelect(element) {
        elementRef.current = element;
        setSelected(locateElement(element));
        setInspecting(false);
        setChatOpen(true);
      },
      onCancel() {
        setInspecting(false);
      },
    });
    pickerRef.current = picker;
    return () => {
      picker.stop();
      pickerRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const picker = pickerRef.current;
    if (!picker) return;
    if (inspecting) picker.start();
    else picker.stop();
  }, [inspecting]);

  useLayoutEffect(() => {
    const node = drawerRef.current?.querySelector('.messages');
    if (node instanceof HTMLElement) node.scrollTop = node.scrollHeight;
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    const tick = (): void => {
      void client.checkHealth().then(
        (ok) => {
          if (!cancelled) setStatus(ok ? 'connected' : 'idle');
        },
        () => {
          if (!cancelled) setStatus('idle');
        },
      );
    };
    tick();
    const timer = window.setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [client]);

  function updateAssistant(id: string, next: (current: string) => string, pending: boolean): void {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, text: next(message.text), pending } : message,
      ),
    );
  }

  async function submit(): Promise<void> {
    const text = prompt.trim();
    if (!text || sending) return;
    const assistantId = createId();
    setPrompt('');
    setSending(true);
    setMessages((current) => [
      ...current,
      { id: createId(), role: 'user', text },
      { id: assistantId, role: 'assistant', text: '', pending: true },
    ]);
    try {
      const live = elementRef.current;
      const selectedElement = live?.isConnected ? locateElement(live) : selected ?? undefined;
      const context = await gatherContext(selectedElement, live);
      await client.streamPrompt({
        provider,
        prompt: text,
        cwd: config.cwd,
        context,
        onChunk(chunk) {
          updateAssistant(assistantId, (current) => current + chunk, false);
        },
        onError(message) {
          updateAssistant(assistantId, (current) => (current ? `${current}\n${message}` : message), true);
        },
        onDone() {
          updateAssistant(assistantId, (current) => current || 'The agent finished without text output.', false);
        },
      });
    } catch (error) {
      if (error instanceof GatewayCancelledError) {
        updateAssistant(assistantId, (current) => current || 'Stopped.', false);
      } else {
        const message = error instanceof Error ? error.message : 'Prompt failed';
        updateAssistant(assistantId, (current) => (current ? `${current}\n${message}` : message), false);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="dock">
      <Toolbar
        inspecting={inspecting}
        chatOpen={chatOpen}
        status={status}
        onToggleInspect={() => setInspecting((value) => !value)}
        onToggleChat={() => setChatOpen((value) => !value)}
      />
      {chatOpen ? (
        <div ref={drawerRef}>
          <ChatDrawer
            selected={selected}
            provider={provider}
            prompt={prompt}
            messages={messages}
            sending={sending}
            onPromptChange={setPrompt}
            onProviderChange={setProvider}
            onClearSelection={() => {
              elementRef.current = null;
              setSelected(null);
            }}
            onSuggest={setPrompt}
            onSubmit={() => {
              void submit();
            }}
            onStop={() => client.cancel()}
            onClose={() => setChatOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function createId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
