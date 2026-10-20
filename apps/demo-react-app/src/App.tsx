import { useState } from 'react';

const PRODUCTS = [
  { name: 'Ceramic lamp', price: '$86', detail: 'Unglazed shade, linen cord' },
  { name: 'Oak tray', price: '$42', detail: 'Oil finish, rounded corners' },
  { name: 'Stone cup', price: '$28', detail: 'Speckled clay, 8 oz' },
];

export function App() {
  return (
    <div className="page">
      <SiteHeader />
      <main>
        <Hero />
        <ProductGrid />
        <Diagnostics />
      </main>
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="site-header">
      <a className="mark" href="#hero">
        Lumen
      </a>
      <nav aria-label="Primary">
        <a href="#hero">Hero</a>
        <a href="#work">Edit</a>
        <a href="#lab">Diagnostics</a>
      </nav>
    </header>
  );
}

function Hero() {
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

function ProductGrid() {
  const [quantity, setQuantity] = useState(1);
  const [selected, setSelected] = useState(PRODUCTS[0]?.name ?? '');
  return (
    <section id="work" className="work">
      <div className="section-heading">
        <h2>The edit</h2>
        <div className="counter" aria-label="Quantity">
          <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Decrease quantity">
            −
          </button>
          <span>{quantity}</span>
          <button type="button" onClick={() => setQuantity((value) => value + 1)} aria-label="Increase quantity">
            +
          </button>
        </div>
      </div>
      <div className="cards">
        {PRODUCTS.map((product) => (
          <button
            key={product.name}
            type="button"
            className={selected === product.name ? 'card selected' : 'card'}
            aria-pressed={selected === product.name}
            onClick={() => setSelected(product.name)}
          >
            <span className="card-name">{product.name}</span>
            <span className="card-detail">{product.detail}</span>
            <strong>{product.price}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function Diagnostics() {
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
          Throw error
        </button>
      </div>
    </section>
  );
}
