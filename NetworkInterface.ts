import { Game } from "phaser";
import { GameEventPayload, KeyboardKey, EventType } from "./GlobalGameReference.js";

// Define a type Logger that has 4 members: info, warn, error, debug,
// all are functions that take a string message and return void
export type Logger = {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
}

// Type for user input events (from client to server)
// Type for game events (from server to client)
export type FGameEvtListener = (type: EventType, event: GameEventPayload) => void;
export type FGameEvtPropagator = FGameEvtListener;

export type FGuiEventListener = (evtType: string, event?: GameEventPayload | undefined) => void;
export type FGuiEvtPropagator = FGuiEventListener;

export type FGameEventRegistrationListener = (listener: FGameEvtListener) => void;
export type FGuiEventRegistrationListener = (listener: FGuiEventListener) => void;

// Client-side network interface (used by GameRenderer)
export class ClientSideNWInterface {
  propagateGameEvt: FGameEvtPropagator | null;
  propagateGuiEvt: FGuiEvtPropagator | null;
  private logger: Logger;
  
  constructor(logger: Logger) {
    this.logger = logger;

    this.propagateGameEvt = null;
    this.propagateGuiEvt = null;
  }

  onGuiEvent(type: string, evtData?: GameEventPayload) {
    if (!this.propagateGuiEvt) {
      this.logger.warn("No game event handler registered to receive game events");
      return;
    }

    // What does ! mean here? It is a non-null assertion operator, which tells TypeScript that we are sure event is not null or undefined at this point. Since GameEventPayload is a union type that includes undefined, we need to assert that it is indeed defined before passing it to the game event handler.
    this.propagateGuiEvt(type, evtData);
  }

  // Called by network/server to deliver game events
  onGameEvt(type: EventType, event: GameEventPayload) {
    if (!this.propagateGameEvt) {
      this.logger.warn("No game event handler registered to receive game events");
      return;
    }

    this.propagateGameEvt(type, event);
  }
}

// Server-side network interface (used by GameEngineFSM)
export class ServerSideNWInterface {
  propagateGameEvt: FGameEvtListener | null;
  propagateGuiEvt: FGuiEventListener | null;
  private logger: Logger;
  constructor(logger: Logger)
  {
    this.logger = logger;

    this.propagateGameEvt = null;
    this.propagateGuiEvt = null;
  }

  // Called by GameRenderer to send user input
  onGuiEvent(type: string, evtData?: GameEventPayload) {
    if (!this.propagateGuiEvt) {
      this.logger.warn("No user input handler registered to receive user input");
      return;
    }
    this.propagateGuiEvt(type, evtData);
  }

  // Called by network/server to deliver game events
  onGameEvt(type: EventType, event: GameEventPayload) {
    if (!this.propagateGameEvt) {
      this.logger.warn("No game event handler registered to receive game events");
      return;
    }
    this.propagateGameEvt(type, event);
  }
}

// Mock bridge setup (for local testing)
// Usage:
// 1. Instantiate both interfaces
// 2. Wire send/receive functions to each other
// 3. GameRenderer uses ClientSideNWInterface
// 4. GameEngineFSM uses ServerSideNWInterface