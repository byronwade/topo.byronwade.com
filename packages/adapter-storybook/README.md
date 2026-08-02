# `@topo/adapter-storybook`

Component-preview adapter for existing Storybook states. It discovers named colocated `.stories.*` exports and exact source lines from Topo's immutable snapshot, then resolves each variant against the running Storybook `/index.json` with a `/stories.json` compatibility fallback. Capture uses the index's real story ID; the adapter never guesses one from a title or filename. Run `pnpm verify:storybook` at the repository root for the Storybook 10 React/Vite and Chromium artifact contract.
