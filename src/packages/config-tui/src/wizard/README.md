# Config wizard

| File | Responsibility |
|---|---|
| `wizard-state.ts` | Wizard types/defaults, `initialState`, provider view projection (`viewOf`) |
| `wizard-prefill.ts` | config.json + .env prefill (`readJsonFile`, `readEnvKeys`, `buildInitialState`) |
| `wizard-edit.ts` | Pending provider edit (atomic rollback), model/profile helpers |
| `wizard-input.ts` | Model/context/port parsers and JEV endpoint validation |
| `wizard-commit.ts` | Synchronous atomic `config.json`/`.env`/`AGENTS.md` writes |
| `wizard-reducer.ts` | Pure `WizardUiState` reducer, `resolveView` routing guards, `allowDecisionProviders` |
| `WizardViews.tsx` | Provider/settings modal views driven by the reducer view union |
| `wizard-overlays.tsx` | Background and quit-confirmation overlays |
| `wizard-logic.ts` (parent) | Public barrel, kept for existing imports |

View order: first-run `providers → apikey → models → profiles → decisions → theme → project → confirm`;
config `menu → (providers → apikey → models) / profiles / decisions / theme / gateway → confirm`.
