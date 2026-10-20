import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { Counter } from '../src/components/Counter';

afterEach(() => {
  cleanup();
});

describe('demo app', () => {
  it('renders the header, hero, counter, card grid, and note form', () => {
    render(<App />);
    expect(screen.getByRole('link', { name: 'Lumen' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Light for the long table.' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add the lamp' }).id).toBe('hero-btn');
    expect(screen.getByRole('button', { name: 'Increase quantity' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ceramic lamp/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'A note for the studio' })).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Message')).toBeTruthy();
  });

  it('steps the counter up and stops at the minimum', () => {
    const seen: number[] = [];
    const { rerender } = render(<Counter value={1} onChange={(value) => seen.push(value)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    rerender(<Counter value={2} onChange={(value) => seen.push(value)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(seen).toEqual([1, 3, 1]);
  });

  it('selects a product card', () => {
    render(<App />);
    const tray = screen.getByRole('button', { name: /Oak tray/ });
    expect(tray.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(tray);
    expect(tray.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows field errors and then accepts a valid note', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Send note' }));
    expect(screen.getAllByRole('alert').map((node) => node.textContent)).toEqual([
      'Enter your name.',
      'Enter a valid email.',
      'Message should be at least 10 characters.',
    ]);
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@analytical.engine' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'The ceramic lamp, please.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send note' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe("Thanks, Ada Lovelace. We'll write back.");
  });
});
