import { useState } from 'react';

export function Hero() {
  const [note, setNote] = useState('A small storefront for trying the inspector.');
  return (
    <section id="hero" className="hero">
      <div className="hero-copy">
        <p className="brand-lockup" aria-hidden="true">
          Lumen
        </p>
        <h1>Light for the long table.</h1>
        <p className="lede">{note}</p>
        <div className="actions">
          <button id="hero-btn" type="button" className="primary" onClick={() => setNote('The ceramic lamp is in the cart.')}>
            Add the lamp
          </button>
          <button type="button" className="secondary" onClick={() => setNote('Saved. You can come back to it.')}>
            Save for later
          </button>
          <a className="secondary" href="#work">
            Browse the edit
          </a>
        </div>
      </div>
      <div className="hero-stage" aria-hidden="true">
        <div className="lamp-glow" />
        <div className="lamp">
          <span className="lamp-shade" />
          <span className="lamp-stem" />
          <span className="lamp-base" />
        </div>
      </div>
    </section>
  );
}
