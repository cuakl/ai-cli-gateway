export interface CounterProps {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  min?: number;
}

export function Counter({ value, onChange, label = 'Quantity', min = 1 }: CounterProps) {
  return (
    <div className="counter" aria-label={label}>
      <button
        type="button"
        aria-label={`Decrease ${label.toLowerCase()}`}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span>{value}</span>
      <button type="button" aria-label={`Increase ${label.toLowerCase()}`} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}
