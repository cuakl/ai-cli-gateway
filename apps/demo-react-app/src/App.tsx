import { CardGrid } from './components/CardGrid';
import { ContactForm } from './components/ContactForm';
import { Diagnostics } from './components/Diagnostics';
import { Header } from './components/Header';
import { Hero } from './components/Hero';

export function App() {
  return (
    <div className="page">
      <Header />
      <main>
        <Hero />
        <CardGrid />
        <ContactForm />
        <Diagnostics />
      </main>
    </div>
  );
}
