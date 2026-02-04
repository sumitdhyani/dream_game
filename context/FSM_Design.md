# FSM Refactor & SubState Design

This document records the design discussion and final decisions for refactoring the game's FSM to support a simpler and safer SubState concept alongside the existing CompositeState pattern. It explains goals, semantics, lifecycle ordering, event routing, API sketches, implementation notes, and testing guidance.

**Purpose**
- Capture the rationale for replacing certain CompositeState uses with a lightweight `SubState` abstraction.
- Define deterministic and easy-to-reason-about semantics for substate lifecycle, event routing, and parent authority.

---

## 1. Background & Goals

- Problem: `CompositeState` is powerful but sometimes over-engineered for short-lived child behaviors (e.g., teleport animation). It mixes state and internal FSM behavior which increases complexity.
- Goal: Provide a simpler `SubState` abstraction for short-lived, specialist child behavior that always returns control to its parent by default, while keeping `CompositeState` for complex nested FSMs.
- Key requirements:
  - Substates should be small, specialist units of behavior (e.g., `Teleporting`).
  - Parent states remain authoritative for coarse decisions (round-end, game-over).
  - Event flow and lifecycle ordering must be deterministic and easy to test.
  - Support optional event deferral during substate activity.

---

## 2. Policy Summary (final)

- Substates are specialists: they handle granular/local events and small tasks.
- Parent states own "big picture" events and transitions (ROUND_END, GAME_OVER, etc.).
- Substates return `SpecialTransition.ReturnToParent` to signal completion and return control to parent.
- Substates cannot unilaterally transition the FSM to an unrelated top-level state.
- Event deferral is handled via explicit `on_<event>()` handlers returning `SpecialTransition.deferralTransition` for events to defer.
- Unhandled events naturally throw `UnhandledEvtException` and bubble to parent state.

---

## 3. Event Routing Semantics

**Approach: currState = SubState**

When a SubState is activated, the FSM sets `currState = subState`. Events go directly to the SubState.

- While a substate is active (`currState instanceof SubState`):
  1. FSM calls `currState.react(evtName, evtData)` as normal
  2. SubState's overridden `react()` handles the event:
     - If handled → return transition result
     - If unhandled → catch `UnhandledEvtException` and bubble to `this.parent.react(evtName, evtData)`
  3. Bubbled events may return transitions from parent (honored by FSM)
- Deferral: when a substate handler returns `SpecialTransition.deferralTransition`, FSM enqueues the event and it is replayed after substate finishes
- Rationale: SubState-first keeps local behavior encapsulated; exception-based bubbling aligns with existing FSM patterns. Deferral via explicit handler returns (not a new property) maintains consistency.

---

## 4. Lifecycle & Transition Ordering

**SubState Activation (Parent → SubState):**

When a parent state returns a SubState from a handler:
1. FSM detects `transition instanceof SubState`
2. Call `currState.onPreemption()` — parent is being paused (NOT `beforeExit()`)
3. Set `currState = subState`
4. Call `handleStateEntry(currState)` — normal entry: `onEntry()`, `on_launch()`, process deferral queue

**SubState Completion (SubState → Parent via ReturnToParent):**

When a substate returns `SpecialTransition.ReturnToParent`:
1. FSM detects `ReturnToParent` transition
2. Call `currState.getReturnPayload()` — SubState-specific method to get result
3. Call `currState.beforeExit()` — cleanup
4. Set `currState = currState.parent` — restore parent as active state
5. Call `currState.onResumeFromSubstate(payload)` — parent reacts to substate result
6. FSM processes deferral queue (any events deferred during substate are replayed)

**Preemptive State Transition (e.g., round_end during SubState):**

When a bubbled event causes a full state transition (not ReturnToParent):
1. SubState bubbles event to parent → parent returns `new SomeOtherState()`
2. FSM detects `transition instanceof State` (but not SubState)
3. FSM walks UP the chain calling `beforeExit()` on each:
   - `currState.beforeExit()` (SubState cleanup)
   - `currState.parent.beforeExit()` (parent cleanup)
   - Continue up if deeper nesting exists
4. Set `currState = transition`
5. Call `handleStateEntry(currState)`

**Key rules:**
- `onPreemption()` is called when parent yields to SubState (symmetric with `onResumeFromSubstate()`)
- `getReturnPayload()` is separate from `beforeExit()` for separation of concerns (result vs cleanup)
- `beforeExit()` remains cleanup-only, no dual-purpose
- Walk-up exit ensures child exits before parent (like C++ destructor order)
- Parent remains alive (not exited) during normal SubState operation; only exits on preemptive transition
- Deferred events (via `SpecialTransition.deferralTransition`) are reprocessed after SubState returns

---

## 5. API Sketch

**SubState class (new)**
- `constructor(parent)` — store parent reference
- `parent` (property) — reference to parent state
- Inherits from `State`: `onEntry()`, `beforeExit()`, `react(evtName, evtData)`
- `getReturnPayload()` (method, default returns `undefined`) — returns result payload for parent
- Overrides `react(evtName, evtData)` — handles event, bubbles to parent on `UnhandledEvtException`
- No explicit `finish()` method; instead return `SpecialTransition.ReturnToParent` from handlers
- No `defersEvents` property; deferral is handled via explicit handler returns

**State class additions**
- `activeSubState` (property, default `null`) — holds active substate if any (for reference, not routing)
- `onPreemption()` (method) — called when this state yields control to a SubState (symmetric with `onResumeFromSubstate`)
- `onResumeFromSubstate(payload)` (method) — called when SubState returns control to this state
- `react(evtName, evtData)` — unchanged; SubState routing is handled by FSM via currState

**SpecialTransition additions**
- `ReturnToParent` — signal for a substate to return control to parent
- `deferralTransition` (existing) — used by substate handlers to defer events

**FSM helper method: exitStateChain(state)**
- Walk UP the parent chain calling `beforeExit()` on each state
- Ensures child cleanup happens before parent (like C++ destructors)
```js
exitStateChain(state) {
    state.beforeExit()
    if (state instanceof SubState) {
        this.exitStateChain(state.parent)
    }
}
```

**FSM.processSingleEvent() updates**
- Detect SubState transition: `transition instanceof SubState`
  - Call `currState.onPreemption()` (not `beforeExit()`)
  - Set `currState = transition`
  - Call `handleStateEntry(currState)`
- Detect ReturnToParent: `transition === SpecialTransition.ReturnToParent`
  - Call `payload = currState.getReturnPayload()`
  - Call `currState.beforeExit()`
  - Set `currState = currState.parent`
  - Call `currState.onResumeFromSubstate(payload)`
  - Process deferral queue
- Detect regular State transition: `transition instanceof State` (but not SubState)
  - Call `this.exitStateChain(currState)` — walks up and exits all
  - Set `currState = transition`
  - Call `handleStateEntry(currState)`
- Deferral queue processing remains unchanged

---

## 6. Backwards Compatibility & CompositeState

- Keep `CompositeState` for cases that need a full nested FSM; `SubState` is the lighter-weight option for short-lived tasks.
- Existing `Teleporting` (if implemented as a CompositeState) should be refactored into a `SubState` for simplicity, unless the behavior requires an internal FSM.

---

## 7. Implementation Plan (Three Phases)

**Phase 1: Extend FSM.js** ✅ COMPLETE
- Added `SpecialTransition.ReturnToParent` constant
- Added `activeSubState` property to `State` class (default `null`)
- Added `onResumeFromSubstate(payload)` hook to `State` class
- Added `SubState` class extending `State` with `parent` property
- Status: All changes committed

**Phase 2: SubState Lifecycle & Event Bubbling** (PENDING)

Changes to implement:

1. **State class: Add `onPreemption()` hook**
   - Empty default implementation
   - Called when parent yields control to SubState

2. **SubState class: Add `getReturnPayload()` method**
   - Default returns `undefined`
   - Separated from `beforeExit()` for single-responsibility

3. **SubState class: Override `react()` for event bubbling**
   - Try `super.react(evtName, evtData)`
   - Catch `UnhandledEvtException` → bubble to `this.parent.react(evtName, evtData)`
   - Return result from whichever handles it

4. **FSM: Add `exitStateChain(state)` helper method**
   - Walk up parent chain calling `beforeExit()` on each
   - Ensures child-before-parent cleanup order

5. **FSM.processSingleEvent(): Handle SubState transitions**
   - Detect `transition instanceof SubState`:
     - Call `currState.onPreemption()`
     - Set `currState = transition`
     - Call `handleStateEntry(currState)`
   - Detect `transition === SpecialTransition.ReturnToParent`:
     - `payload = currState.getReturnPayload()`
     - `currState.beforeExit()`
     - `currState = currState.parent`
     - `currState.onResumeFromSubstate(payload)`
     - Process deferral queue
   - Detect regular `transition instanceof State` (not SubState):
     - Call `this.exitStateChain(currState)`
     - Set `currState = transition`
     - Call `handleStateEntry(currState)`

- Status: Design approved, implementation pending

**Phase 3: Refactor GameEngineFSM.js** (PENDING)
- Convert `PlayingRound` from `CompositeState` to regular `State`
- Refactor `Teleporting` → `TeleportingSubState` (extends `SubState`)
- Update `PlayingRound`:
  - On wormhole detection, return `new TeleportingSubState(this)`
  - Implement `onResumeFromSubstate(payload)` to handle teleport completion
- Update imports (remove `CompositeState`, add `SubState`)
- Status: Awaiting Phase 2 completion

**Phase 4: Remove CompositeState** (PENDING)
- Remove `CompositeState` class from FSM.js
- Update documentation (Context.md, IMPLEMENTATION_SUMMARY.md)
- Status: Awaiting Phase 3 completion (no more usages)

---

## 8. Testing Checklist

**Phase 1 & 2 (FSM infrastructure):**
- ✅ `SubState` class exists and extends `State`
- ✅ `SpecialTransition.ReturnToParent` is defined
- ✅ State has `activeSubState` property
- ✅ State has `onResumeFromSubstate()` hook
- `State.react()` routes to active substate (Phase 2)
- Unhandled events bubble from substate to parent (Phase 2)
- `ReturnToParent` trigger calls `onResumeFromSubstate()` with payload (Phase 2)

**Phase 3 (Teleporting integration):**
- `TeleportingSubState` activates when wormhole is detected
- Input deferred during teleport animation (key presses return `deferralTransition`)
- Teleport animation completes (600ms timer)
- Substate returns `ReturnToParent`
- Parent `PlayingRound.onResumeFromSubstate()` is called
- Deferred input is replayed and processed
- Round transitions (round_end) still work correctly
- `PLAYER_TELEPORTED` event is emitted to renderer

---

## 9. Design Refinements (From Conversation)

**Q: Why not use explicit `finish(resultPayload)` method?**
A: Using `SpecialTransition.ReturnToParent` keeps the design consistent with existing FSM patterns. States already communicate intent via special transitions; adding a new API (explicit method calls) would complicate the contract.

**Q: Why `getReturnPayload()` instead of using `beforeExit()` return value?**
A: Separation of concerns. `beforeExit()` is for cleanup (stop animations, destroy sprites). `getReturnPayload()` is for returning results to parent. Mixing them creates awkward code where cleanup logic contains payload construction. `getReturnPayload()` is defined only on SubState, making intent clear.

**Q: Why `onPreemption()` instead of `beforeExit()` when parent yields to SubState?**
A: Semantic clarity. The parent is not exiting—it's being temporarily paused. `onPreemption()` signals "you're being interrupted" while `beforeExit()` signals "you're leaving". This is symmetric with `onResumeFromSubstate()` when control returns.

**Q: Why not add a `defersEvents` boolean property to SubState?**
A: Initially proposed but replaced with selective deferral via explicit handlers. Why:
- More flexible: substates can defer some events and handle/bubble others
- Less boilerplate: no need for catch-all handlers if deferral flag is used
- Consistent: uses existing `SpecialTransition.deferralTransition` pattern, not a new property
- Example: `TeleportingSubState` defers key presses but could handle special events if needed

**Q: Should substate routing be in FSM or State?**
A: Decided: in `State.react()`. Why:
- Better encapsulation: a state owns its substate and manages its lifecycle
- Consistent with `CompositeState` pattern (already overrides `react()`)
- Keeps FSM simple: no special substate handling needed in core FSM logic
- More extensible: future state types can customize substate behavior

---

## 10. Next Steps

**Phase 2 (Ready to implement):**
- Update `State.react()` to handle substate routing, bubbling, and `ReturnToParent`
- No FSM changes required
- Request user approval before implementation

**Phase 3 (After Phase 2):**
- Refactor `Teleporting` in `GameEngineFSM.js` to `TeleportingSubState`
- Update `PlayingRound` to activate/resume with substates
- Run integration tests with teleportation flow

---

Document updated with Phase 1 completion status and refined Phase 2/3 design based on discussion.
Refer to the `context` folder for canonical conversation artifacts and the implementation summary.
