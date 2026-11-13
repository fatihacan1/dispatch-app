# Dispatch desktop

The Electron app. See the [main README](../README.md) for what it does.

```
npm install
npm run build:core   # builds the bundled dispatch CLI (needs Go)
npm run dev          # starts the app; npm run dev -- --demo uses fake agents
```

- `npm test` runs the unit tests, `npm run e2e` the Playwright tests (they start Electron in demo mode).
- `npm run dist` builds the installer into `release/`.
- In `npm run dev`, the beaker button at the bottom of the rail loads a mock workspace with agents, messages, memory, skills and schedules, so you can work on any screen without real providers.
- README screenshots: start `npx vite --port 5199`, then `node e2e/readme-shots.cjs ../docs/images "Operation:chat,Agent templates:teams,Tools:tools,Boss memory:memory,Skills:skills"`.

Code map: `electron/` is the main process (one module per feature, e.g. `telegram.cjs`, `schedules.cjs`, `memory.cjs`, `skills.cjs`), `src/views/` the screens, `src/office/` the 3D office scenes.
