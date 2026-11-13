/** Side-panel toggle glyph: the right column slides in/out with the panel state. */
export function PanelIcon({ open }: { open: boolean }) {
  return (
    <svg className={"panel-icon" + (open ? " open" : "")} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect className="panel-icon-col" x="9.5" y="4.25" width="3.25" height="7.5" rx="0.75" />
    </svg>
  );
}
