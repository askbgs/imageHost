"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { sendContactMessage, type ContactState } from "@/app/actions/contact";
import { CONTACT_TOPICS, type ContactTopic } from "@/lib/contact";

export function ContactForm({
  name,
  email,
  topic,
  contactEmail,
  abuseEmail,
}: {
  name?: string;
  email?: string;
  topic: ContactTopic;
  contactEmail: string;
  abuseEmail: string;
}) {
  const [state, action, pending] = useActionState<ContactState, FormData>(
    sendContactMessage,
    {},
  );
  const [chosen, setChosen] = useState<ContactTopic>(topic);
  // When the form was shown; set after hydration so it reflects the visitor, not the server render.
  const [started, setStarted] = useState("");
  useEffect(() => setStarted(String(Date.now())), []);

  if (state.ok) {
    return (
      <div className="panel contact-done" role="status">
        <h2>Thanks, we&apos;ve got your message</h2>
        <p>
          We reply from <strong>{contactEmail}</strong>, usually within one or
          two working days. Check your spam folder if you don&apos;t see it.
        </p>
        <Link className="btn secondary" href="/">
          Back to the home page
        </Link>
      </div>
    );
  }

  const f = state.fields ?? {};
  return (
    <form action={action} className="panel contact-form" noValidate={false}>
      {state.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}
      <div className="contact-row">
        <div className="field">
          <label htmlFor="c-name">Your name</label>
          <input
            id="c-name"
            name="name"
            type="text"
            required
            maxLength={100}
            autoComplete="name"
            defaultValue={f.name ?? name}
          />
        </div>
        <div className="field">
          <label htmlFor="c-email">Email</label>
          <input
            id="c-email"
            name="email"
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            defaultValue={f.email ?? email}
          />
          <span className="field-hint">We&apos;ll reply to this address.</span>
        </div>
      </div>
      <div className="field">
        <label htmlFor="c-topic">What&apos;s it about?</label>
        <select
          id="c-topic"
          name="topic"
          value={chosen}
          onChange={(e) => setChosen(e.target.value as ContactTopic)}
        >
          {(Object.keys(CONTACT_TOPICS) as ContactTopic[]).map((t) => (
            <option key={t} value={t}>
              {CONTACT_TOPICS[t]}
            </option>
          ))}
        </select>
        {chosen === "abuse" && (
          <span className="field-hint">
            To report one image, the fastest way is{" "}
            <strong>Report this image</strong> on its page. For copyright or
            legal notices you can also email{" "}
            <a href={`mailto:${abuseEmail}`}>{abuseEmail}</a>.
          </span>
        )}
      </div>
      <div className="field">
        <label htmlFor="c-message">Message</label>
        <textarea
          id="c-message"
          name="message"
          required
          minLength={10}
          maxLength={5000}
          rows={7}
          defaultValue={f.message}
          placeholder={
            chosen === "api"
              ? "What are you building, and what happens when you call the API?"
              : "How can we help?"
          }
        />
      </div>
      {/* Spam traps: hidden from people, filled in by bots. */}
      <div className="hp" aria-hidden="true">
        <label htmlFor="c-website">Leave this empty</label>
        <input
          id="c-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      <input type="hidden" name="started" value={started} />
      <div className="contact-actions">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Sending…" : "Send message"}
        </button>
        <span className="field-hint">
          Or email <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </span>
      </div>
    </form>
  );
}
