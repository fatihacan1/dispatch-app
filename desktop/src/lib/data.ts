import type { Message } from "./types";
export const providers = [
  "claude",
  "codex",
  "antigravity",
  "opencode",
  "qoder",
  "local",
];
export const labels: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  qoder: "Qoder",
  local: "Local AI",
};
export const demoMessages: Message[] = [
  {
    id: "d1",
    from: "you",
    to: "boss",
    text: "Add token refresh to the auth module, with tests.",
  },
  {
    id: "d2",
    from: "boss",
    to: "you",
    text: "I’ll split this: Coder implements, Scout checks coverage.",
  },
  { id: "d3", from: "boss", to: "coder", text: "Implement token refresh." },
  {
    id: "d4",
    from: "boss",
    to: "scout",
    text: "Check test coverage after coder’s change.",
  },
  {
    id: "d5",
    from: "coder",
    to: "boss",
    text: "Implementation started: refresh flow and tests.",
  },
];
