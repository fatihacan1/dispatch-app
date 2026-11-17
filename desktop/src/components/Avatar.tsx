import { ProviderIcon } from "./common";

// Chat avatar in a ring of the sender's color: a crown for the boss, a person for you, the provider's logo for any
// other agent. The ring keeps two agents on the same provider apart.
export function Avatar({ name, provider, color, size = 36 }: { name: string; provider?: string; color: string; size?: number }) {
  return (
    <span className={`avatar ring-${color}`} style={{ width: size, height: size }} aria-hidden="true">
      {name === "boss" ? <svg className="crown" viewBox="0 0 24 24" strokeWidth={1.2} strokeLinejoin="round"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z" fill="var(--crown)" stroke="var(--crown-edge)" /><path d="M5.4 15.5h13.2" stroke="var(--crown-edge)" /><circle cx="12" cy="5" r="1.4" fill="var(--danger)" stroke="none" /><circle cx="3" cy="8" r="1.1" fill="var(--crown)" stroke="none" /><circle cx="21" cy="8" r="1.1" fill="var(--crown)" stroke="none" /></svg>
        : name === "you" ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
        : <ProviderIcon provider={provider || "claude"} alt="" />}
    </span>
  );
}
