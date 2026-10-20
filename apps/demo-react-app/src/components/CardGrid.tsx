import { useState } from 'react';
import { Counter } from './Counter';

const PRODUCTS = [
  { name: 'Ceramic lamp', price: '$86', detail: 'Unglazed shade, linen cord' },
  { name: 'Oak tray', price: '$42', detail: 'Oil finish, rounded corners' },
  { name: 'Stone cup', price: '$28', detail: 'Speckled clay, 8 oz' },
];

export function CardGrid() {
  const [quantity, setQuantity] = useState(1);
  const [selected, setSelected] = useState(PRODUCTS[0]?.name ?? '');
  return (
    <section id="work" className="work">
      <div className="section-heading">
        <h2>The edit</h2>
        <Counter value={quantity} onChange={setQuantity} />
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
