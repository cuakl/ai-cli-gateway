import { useState } from 'react';

export function Hero() {
  const [note, setNote] = useState('A small storefront for trying the inspector.');
  return (
    <section id="hero" className="hero">
      <p className="eyebrow">Spring edit</p>
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
    </section>
  );
}
