# %%NAME%%

A [Forgor](https://github.com/LLefu/Forgor) plugin.

```sh
npm install
npm run zip   # → %%ID%%-1.0.0.zip
```

In Forgor: **Plugins → Install from zip**, then turn it on. After a change, `npm run zip` again and use **Update from zip** in the plugin's panel.

- The plugin is in `src/index.tsx`, its name and version in `manifest.json`.
- **Everything about writing a Forgor plugin is in [AGENTS.md](AGENTS.md):** the API, what you can add, styling, the rules, and publishing to the store. It's written so an AI assistant can work from it too; `CLAUDE.md` points Claude to it.
