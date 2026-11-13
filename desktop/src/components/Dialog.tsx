import React, { useEffect, useId, useRef } from "react";
import { XMarkIcon } from "@heroicons/react/16/solid";

type Props = {
  title: string;
  onClose: () => void;
  size?: "sm" | "md" | "lg";
  description?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
};

/** The one modal used across the app: same overlay, header, footer, sizes and motion. */
export function Dialog({ title, onClose, size = "sm", description, footer, className = "", children }: Props) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key);
    const previous = document.activeElement as HTMLElement | null;
    if (!box.current?.contains(document.activeElement)) box.current?.querySelector<HTMLElement>("[autofocus], input, textarea, select, button:not(.dialog-x)")?.focus();
    return () => { window.removeEventListener("keydown", key); previous?.focus?.(); };
  }, []);
  return (
    <div className="dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className={`dialog dialog-${size} ${className}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <header className="dialog-head">
          <h2 id={id}>{title}</h2>
          <button type="button" className="icon-button dialog-x" aria-label="Close" onClick={onClose}><XMarkIcon /></button>
        </header>
        {description && <p className="dialog-desc">{description}</p>}
        {children && <div className="dialog-body">{children}</div>}
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </div>
  );
}
