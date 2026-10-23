import { useState } from 'react';

export function Diagnostics() {
  const [message, setMessage] = useState('Nothing logged yet.');
  return (
    <section id="lab" className="lab">
      <h2>Diagnostics</h2>
      <p>{message}</p>
      <div className="actions">
        <button
          type="button"
          className="warn"
          onClick={() => {
            console.warn('Demo warning: inventory for the ceramic lamp is low.');
            setMessage('Warning sent to the console.');
          }}
        >
          Log warning
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => {
            console.error('Demo error: checkout service returned 503.');
            setMessage('Error sent to the console.');
          }}
        >
          Log error
        </button>
        <button
          type="button"
          className="danger ghost"
          onClick={() => {
            setMessage('Throwing a runtime error.');
            window.setTimeout(() => {
              throw new Error('Demo runtime error from the diagnostics panel');
            }, 0);
          }}
        >
          Throw
        </button>
      </div>
    </section>
  );
}
