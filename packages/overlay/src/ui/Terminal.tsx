import { useEffect, useRef, useState } from 'preact/hooks';
import type { Terminal as XtermTerminal } from '@xterm/xterm';
import xtermCss from '@xterm/xterm/css/xterm.css?inline';
import { AID_MONO, DARK_PALETTE } from './theme/tokens.js';
import type { WorkspaceConnection } from './workspace-client.js';

export interface TerminalPanelProps {
  workspace: WorkspaceConnection;
  hidden?: boolean;
}

export function TerminalPanel({ workspace, hidden = false }: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let term: XtermTerminal | null = null;
    let sessionId = '';
    const pendingInput: string[] = [];
    const pendingOutput: Array<{ id: string; data: string }> = [];
    const cleanups: Array<() => void> = [];

    const root = host.getRootNode();
    if (root instanceof ShadowRoot && !root.querySelector('style[data-xterm]')) {
      const style = document.createElement('style');
      style.dataset.xterm = 'true';
      style.textContent = xtermCss;
      root.appendChild(style);
    }

    void (async () => {
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
        ]);
        if (cancelled) return;
        term = new Terminal({
          cursorBlink: true,
          fontFamily: AID_MONO,
          fontSize: 12,
          theme: {
            background: DARK_PALETTE.bg,
            foreground: DARK_PALETTE.text,
            cursor: DARK_PALETTE.accent,
          },
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        await waitForSize(host);
        if (cancelled) return;
        term.open(host);
        const safeFit = (): void => {
          if (host.clientWidth === 0 || host.clientHeight === 0) return;
          try {
            fit.fit();
          } catch {
            // The dock may not have a size on the first frame.
          }
        };
        safeFit();

        const offData = workspace.on('pty.data', (message) => {
          if (!sessionId) {
            pendingOutput.push({ id: message.sessionId, data: message.data });
            return;
          }
          if (message.sessionId === sessionId) term?.write(message.data);
        });
        const offExit = workspace.on('pty.exit', (message) => {
          if (message.sessionId === sessionId) term?.write(`\r\n[process exited with code ${message.code}]\r\n`);
        });
        cleanups.push(offData, offExit);

        const input = term.onData((data) => {
          if (!sessionId) pendingInput.push(data);
          else workspace.send({ type: 'pty.input', sessionId, data });
        });
        const resize = term.onResize(({ cols, rows }) => {
          if (sessionId) workspace.send({ type: 'pty.resize', sessionId, cols, rows });
        });
        cleanups.push(() => input.dispose(), () => resize.dispose());

        if (typeof ResizeObserver !== 'undefined') {
          const observer = new ResizeObserver(() => {
            safeFit();
          });
          observer.observe(host);
          cleanups.push(() => observer.disconnect());
        }

        const session = await workspace.request({
          type: 'pty.spawn',
          cols: term.cols || 80,
          rows: term.rows || 24,
        });
        if (cancelled) {
          workspace.send({ type: 'pty.dispose', sessionId: session.sessionId });
          return;
        }
        sessionId = session.sessionId;
        for (const chunk of pendingOutput.splice(0)) {
          if (chunk.id === sessionId) term.write(chunk.data);
        }
        for (const chunk of pendingInput.splice(0)) workspace.send({ type: 'pty.input', sessionId, data: chunk });
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Terminal failed to start');
      }
    })();

    return () => {
      cancelled = true;
      if (sessionId) workspace.send({ type: 'pty.dispose', sessionId });
      for (const cleanup of cleanups) cleanup();
      term?.dispose();
    };
  }, [workspace]);

  return (
    <section className="panel" aria-label="Terminal" hidden={hidden} aria-hidden={hidden}>
      {error ? <p className="banner">{error}</p> : null}
      <div ref={hostRef} className="terminal-host" tabIndex={0} />
    </section>
  );
}

function waitForSize(host: HTMLElement): Promise<void> {
  if (host.clientWidth > 0 && host.clientHeight > 0) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      resolve();
    };
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        if (host.clientWidth > 0 && host.clientHeight > 0) finish();
      });
      observer.observe(host);
    }
    setTimeout(finish, 50);
  });
}
