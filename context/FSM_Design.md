# FSM Refactor & SubState Design

This document records the design discussion and final decisions for refactoring the game's FSM to support a simpler and safer SubState concept. It explains goals, semantics, lifecycle ordering, event routing, API sketches, implementation notes, and testing guidance.

**Purpose**
- Capture the rationale for using a lightweight `SubState` abstraction for short-lived child behaviors.
- Define deterministic and easy-to-reason-about semantics for substate lifecycle, event routing, and parent authority.

**Status: ✅ FULLY IMPLEMENTED**

---

## 1. Background & Goals

- Problem: Complex nested states add unnecessary overhead for short-lived child behaviors (e.g., teleport animation).
- Solution: A simple `SubState` abstraction for short-lived, specialist child behavior that always returns control to its parent.
- Key requirements:
  - Substates should be small, specialist units of behavior (e.g., `TeleportingSubState`).
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

## 6. Backwards Compatibility

- CompositeState has been removed from the codebase.
- SubState is the lightweight option for short-lived tasks like teleportation animation.
- `TeleportingSubState` uses the SubState pattern with event deferral for input during animation.

---

## 7. Implementation Status

**All Phases Complete ✅**

**Phase 1: Extend FSM.ts** ✅ COMPLETE
- Added `SpecialTransition.ReturnToParent` constant
- Added `activeSubState` property to `State` class (default `null`)
- Added `onResumeFromSubstate(payload)` hook to `State` class
- Added `SubState` class extending `State` with `parent` property

**Phase 2: SubState Lifecycle & Event Bubbling** ✅ COMPLETE
- Added `onPreemption()` hook to State class
- Added `getReturnPayload()` method to SubState class
- SubState `react()` override for event bubbling to parent
- Added `exitStateChain(state)` helper method to FSM
- FSM.processSingleEvent() handles SubState transitions correctly

**Phase 3: Refactor GameEngineFSM.ts** ✅ COMPLETE
- `PlayingRound` is a regular `State` (not CompositeState)
- `TeleportingSubState` extends `SubState`
- PlayingRound transitions to TeleportingSubState on wormhole detection
- PlayingRound.onResumeFromSubstate() handles teleport completion

**Phase 4: Remove CompositeState** ✅ COMPLETE
- CompositeState class removed from FSM.ts
- All documentation updated

---

## 8. Testing Checklist

**Phase 1 & 2 (FSM infrastructure):** ✅ All Complete
- ✅ `SubState` class exists and extends `State`
- ✅ `SpecialTransition.ReturnToParent` is defined
- ✅ State has `activeSubState` property
- ✅ State has `onResumeFromSubstate()` hook
- ✅ State has `onPreemption()` hook
- ✅ State.react() routes to active substate
- ✅ Unhandled events bubble from substate to parent
- ✅ `ReturnToParent` trigger calls `onResumeFromSubstate()` with payload

**Phase 3 (Teleporting integration):** ✅ All Complete
- ✅ `TeleportingSubState` activates when wormhole is detected
- ✅ Input deferred during teleport animation (key presses return `deferralTransition`)
- ✅ Teleport animation completes (600ms timer)
- ✅ Substate returns `ReturnToParent`
- ✅ Parent `PlayingRound.onResumeFromSubstate()` is called
- ✅ Deferred input is replayed and processed
- ✅ Round transitions (round_end) still work correctly
- ✅ `PLAYER_TELEPORTED` event is emitted to renderer

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

## 10. Current Architecture

**FSM Framework (FSM.ts):**
- Generic `State<TEventData, TResumePayload>` class
- Generic `SubState<TEventData, TReturnPayload>` class
- Generic `FSM<TEventData, TResumePayload>` class
- Logger interface with `info`, `warn`, `error`, `debug` methods

**GameEngineFSM States:**
- `PreStart` - Waits for game configuration from client
- `PlayingRound` - Main gameplay with movement, bots, wormholes
- `TeleportingSubState` - Animation phase during wormhole teleportation
- `RoundEnded` - Elimination phase, prepares next round
- `GameOver` - Final state, shows winner

**Event Types:**
- `GUIEventPayload` - Input events from client (KeyboardKey | GameConfig)
- `GameEventPayload` - Game state events to client

Document updated to reflect full implementation completion.
Refer to the `context` folder for canonical conversation artifacts and the implementation summary.
