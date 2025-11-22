# Refactor plan for `src/routes/index.tsx`

## Goal

Extract CSV parsing/compare orchestration from the route-level UI component into a custom hook and smaller controls UI component to reduce complexity in the page and make parsing/compare logic reusable/testable.

## Suggested new files

- `src/hooks/useCsvCompare.ts`
- `src/routes/ComparePage/Controls/ComparisonControls.tsx`

## Symbols to move

- Parsing orchestration (`parse` calls), `startCompare` and `startChunkedDiff` logic, progress state and result state
- CSV input pair UI into a `ComparisonControls` component, which is purely presentational and emits control events

## What to keep

- Keep `index.tsx` as a composition component that wires `ComparisonControls`, `ConfigPanel`, and `DiffTable` together using the returned state and actions from `useCsvCompare`.

## Implementation steps

1. Implement `useCsvCompare` hook:
   - Expose: `sourceCsv`, `targetCsv`, `parse`, `startCompare`, `startChunkedDiff`, `progress`, `results`, and `reset`.
   - Keep the worker interactions abstracted behind the hook and pass worker instance or `workerContext` as a dependency to the hook.
2. Create `ComparisonControls` component that emits events (`onSourceChange`, `onTargetChange`, `onStartCompare`, `onStartChunkedDiff`) and renders CSV inputs and basic controls.
3. Replace inline controls in `index.tsx` with `ComparisonControls` and use the hook for logic.
4. Add tests for `useCsvCompare` mocking the worker to simulate parse progress and results.

## Tests to add

- `useCsvCompare` unit tests for normal and chunked compare flows.
- `ComparisonControls` UI tests for event emission.

## Risks and mitigations

- The hook will depend on worker APIs; use dependency injection so tests can supply a mocked worker interface.
- Keep `index.tsx` state minimal and favor hook-provided derived states to avoid duplication.

## Rollout plan

1. Implement the `useCsvCompare` with minimal functionality (parse and track progress) and wire it into `index.tsx` as a continuity change.
2. Move UI controls to `ComparisonControls` and ensure they bind to the hook's callbacks.
3. Expand hook tests and CI coverage.
