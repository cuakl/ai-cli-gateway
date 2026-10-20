import { useEffect, useRef, useState } from 'preact/hooks';
import type { Terminal as XtermTerminal } from '@xterm/xterm';
import xtermCss from '@xterm/xterm/css/xterm.css?inline';
import type { DevtoolsBridge } from '../types.js';

export interface TerminalPanelProps {
  bridge: DevtoolsBridge;
  onClose: () => void;
}

export function TerminalPanel({ bridge, onClose }: TerminalPanelProps) {
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
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          theme: { background: '#101319', foreground: '#e7e9ee' },
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(host);
        try {
          fit.fit();
        } catch {
          // The drawer may not have a size on the first frame.
        }

        const offData = bridge.onPtyData((id, data) => {
          if (!sessionId) {
            pendingOutput.push({ id, data });
            return;
          }
          if (id === sessionId) term?.write(data);
        });
        const offExit = bridge.onPtyExit((id, code) => {
          if (id === sessionId) term?.write(`\r\n[process exited with code ${code}]\r\n`);
        });
        cleanups.push(offData, offExit);

        const input = term.onData((data) => {
          if (!sessionId) pendingInput.push(data);
          else bridge.writePty(sessionId, data);
        });
        const resize = term.onResize(({ cols, rows }) => {
          if (sessionId) bridge.resizePty(sessionId, cols, rows);
        });
        cleanups.push(() => input.dispose(), () => resize.dispose());

        if (typeof ResizeObserver !== 'undefined') {
          const observer = new ResizeObserver(() => {
            try {
              fit.fit();
            } catch {
              // Ignore fit races while the panel is closing.
            }
          });
          observer.observe(host);
          cleanups.push(() => observer.disconnect());
        }

        const session = await bridge.spawnPty(term.cols || 80, term.rows || 24);
        if (cancelled) {
          bridge.disposePty(session.sessionId);
          return;
        }
        sessionId = session.sessionId;
        for (const chunk of pendingOutput.splice(0)) {
          if (chunk.id === sessionId) term.write(chunk.data);
        }
        for (const chunk of pendingInput.splice(0)) bridge.writePty(sessionId, chunk);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Terminal failed to start');
      }
    })();

    return () => {
      cancelled = true;
      if (sessionId) bridge.disposePty(sessionId);
      for (const cleanup of cleanups) cleanup();
      term?.dispose();
    };
  }, [bridge]);

  return (
    <section className="drawer wide" aria-label="Terminal">
      <header className="drawer-header">
        <h2>Terminal</h2>
        <button type="button" className="icon-button" data-action="close-terminal" onClick={onClose}>
          ✕
        </button>
      </header>
      {error ? <p className="banner">{error}</p> : null}
      <div ref={hostRef} className="terminal-host" />
    </section>
  );
}
