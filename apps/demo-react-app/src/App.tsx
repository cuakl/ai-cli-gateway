import { CardGrid } from './components/CardGrid';
import { ContactForm } from './components/ContactForm';
import { Diagnostics } from './components/Diagnostics';
import { Header } from './components/Header';
import { Hero } from './components/Hero';

export function App() {
  return (
    <div className="app">
      <div className="hero-shell">
        <Header />
        <Hero />
      </div>
      <div className="page">
        <main>
          <CardGrid />
          <ContactForm />
          <Diagnostics />
        </main>
      </div>
    </div>
  );
}
