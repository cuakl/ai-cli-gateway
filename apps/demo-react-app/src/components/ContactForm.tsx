import { useState, type FormEvent } from 'react';
import { validateContact, type ContactErrors, type ContactValues } from './validation';

const EMPTY: ContactValues = { name: '', email: '', message: '' };

export function ContactForm() {
  const [values, setValues] = useState<ContactValues>(EMPTY);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [sent, setSent] = useState(false);

  function update(field: keyof ContactValues, value: string): void {
    setValues((current) => ({ ...current, [field]: value }));
    setSent(false);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next = validateContact(values);
    setErrors(next);
    setSent(Object.keys(next).length === 0);
  }

  return (
    <section id="contact" className="contact">
      <h2>A note for the studio</h2>
      <p className="lede">Tell us which piece you want, and how to reach you.</p>
      <form className="note-form" onSubmit={onSubmit} noValidate>
        <Field
          id="contact-name"
          label="Name"
          value={values.name}
          error={errors.name}
          onChange={(value) => update('name', value)}
        />
        <Field
          id="contact-email"
          label="Email"
          type="email"
          value={values.email}
          error={errors.email}
          onChange={(value) => update('email', value)}
        />
        <label className="field" htmlFor="contact-message">
          Message
          <textarea
            id="contact-message"
            name="message"
            rows={4}
            value={values.message}
            aria-invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? 'contact-message-error' : undefined}
            onChange={(event) => update('message', event.target.value)}
          />
        </label>
        {errors.message ? (
          <p id="contact-message-error" className="field-error" role="alert">
            {errors.message}
          </p>
        ) : null}
        <div className="actions">
          <button type="submit" className="primary">
            Send note
          </button>
        </div>
        {sent ? (
          <p className="form-success" role="status">
            Thanks, {values.name.trim()}. We'll write back.
          </p>
        ) : null}
      </form>
    </section>
  );
}

function Field({
  id,
  label,
  value,
  error,
  onChange,
  type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <>
      <label className="field" htmlFor={id}>
        {label}
        <input
          id={id}
          name={id}
          type={type}
          value={value}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      {error ? (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
