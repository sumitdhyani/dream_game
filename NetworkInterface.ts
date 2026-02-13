import { Game } from "phaser";
import { GameEventPayload, KeyboardKey, EventType, GUIEventPayload } from "./GlobalGameReference.js";

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
export type FGameEvtListener = (type: EventType, event?: GameEventPayload) => void;
export type FGameEvtPropagator = FGameEvtListener;

export type FGuiEventListener = (evtType: string, event?: GUIEventPayload) => void;
export type FGuiEvtPropagator = FGuiEventListener;

// ============================================================================
// GameEventEmitter - Multicast delegate for game events
// Allows multiple listeners (GameRenderer, BotClients) to subscribe
// ============================================================================
export class GameEventEmitter {
    private listeners: Set<FGameEvtListener> = new Set()

    /**
     * Register a listener to receive game events
     */
    register(listener: FGameEvtListener): void {
        this.listeners.add(listener)
    }

    /**
     * Unregister a listener
     */
    unregister(listener: FGameEvtListener): void {
        this.listeners.delete(listener)
    }

    /**
     * Emit a game event to all registered listeners
     */
    emit(type: EventType, payload?: GameEventPayload): void {
        this.listeners.forEach(listener => listener(type, payload))
    }

    /**
     * Check if any listeners are registered
     */
    hasListeners(): boolean {
        return this.listeners.size > 0
    }
}

// Client-side network interface (used by GameRenderer)
export class ClientSideNWInterface {
  propagateGuiEvt: FGuiEvtPropagator | null;
  
  /** Event emitter for game events - register listeners here */
  readonly gameEventEmitter: GameEventEmitter = new GameEventEmitter();
  
  private logger: Logger;
  
  constructor(logger: Logger) {
    this.logger = logger;

    this.propagateGuiEvt = null;
  }

  onGuiEvent(type: string, evtData?: GUIEventPayload) {
    if (!this.propagateGuiEvt) {
      this.logger.warn("No game event handler registered to receive game events");
      return;
    }

    // What does ! mean here? It is a non-null assertion operator, which tells TypeScript that we are sure event is not null or undefined at this point. Since GameEventPayload is a union type that includes undefined, we need to assert that it is indeed defined before passing it to the game event handler.
    this.propagateGuiEvt(type, evtData);
  }

  // Called by network/server to deliver game events
  onGameEvt(type: EventType, event?: GameEventPayload) {
    // First, emit to all registered listeners (new pattern)
    this.gameEventEmitter.emit(type, event);
    
    // Warn only if neither is configured
    if (!this.gameEventEmitter.hasListeners()) {
      this.logger.warn("No game event handler registered to receive game events");
    }
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
  onGuiEvent(type: string, evtData?: GUIEventPayload) {
    if (!this.propagateGuiEvt) {
      this.logger.warn("No user input handler registered to receive user input");
      return;
    }
    this.propagateGuiEvt(type, evtData);
  }

  // Called by network/server to deliver game events
  onGameEvt(type: EventType, event?: GameEventPayload) {
    this.logger.debug(`ServerSideNWInterface received game event: ${type}, data: ${JSON.stringify(event)}`);
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