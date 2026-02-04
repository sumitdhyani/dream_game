// ============================================================================
// FSM Error Types
// ============================================================================

export class AFSMError extends Error {
    constructor(message: string) {
        super(message)
        this.name = this.constructor.name
    }
}

export class FinalityReachedException extends AFSMError {
    constructor() {
        super("State machine has reached final state and can't process any new events")
    }
}

export class SMInactiveException extends AFSMError {
    constructor() {
        super("State machine needs to be started by calling the start() method")
        this.name = "SMInactiveException"
    }
}

export class UnhandledEvtException extends AFSMError {
    constructor(stateName: string, evtName: string) {
        super(`Event: ${evtName} is unhandled in state: ${stateName}`)
    }
}

export class ImproperReactionException extends AFSMError {
    constructor(stateName: string, evtName: string, reactionType: string) {
        super(
            `Improper reaction from state: ${stateName}, while handling event: ${evtName}, ` +
            `the reaction should be either a new state or a member of "SpecialTransition", ` +
            `but the type of the reaction was of type: ${reactionType}`
        )
    }
}

export class RecursiveEventException extends AFSMError {
    constructor() {
        super(`Raising an event on FSM while it is already processing an event`)
    }
}

// ============================================================================
// Types & Interfaces
// ============================================================================

export const SpecialTransition = {
    nullTransition: "nullTransition",
    undefined: "nullTransition",
    null: "nullTransition",
    deferralTransition: "deferralTransition",
    ReturnToParent: "ReturnToParent"
} as const

export type SpecialTransitionValue = typeof SpecialTransition[keyof typeof SpecialTransition]

/** The result of a state's event handler */
export type Transition<TEventData, TResumePayload> = State<TEventData, TResumePayload> | SpecialTransitionValue | void

/** Logger interface for FSM logging */
export interface Logger {
    info(message: string): void
    warn(message: string): void
}

/** A deferred event in the queue */
type DeferredEvent<TEventData> = [string, TEventData | null]

// ============================================================================
// State Class
// ============================================================================

export class State<TEventData, TResumePayload> {
    readonly isFinal: boolean
    readonly name: string
    inited: boolean
    activeSubState: SubState<TEventData, TResumePayload> | null

    constructor(isFinal: boolean = false) {
        this.isFinal = isFinal
        this.name = this.constructor.name
        this.inited = false
        this.activeSubState = null
    }

    /** Called after on_launch event */
    on_launch(): Transition<TEventData, TResumePayload> {
        return SpecialTransition.nullTransition
    }

    /** Called when entering this state */
    onEntry(): void { }

    /** Called when exiting this state */
    beforeExit(): void { }

    /** Called when this state yields control to a SubState */
    onPreemption(): void { }

    /** Called when a SubState returns control to this state */
    onResumeFromSubstate(_payload: TResumePayload): void { }

    /** Returns true if this is a final state */
    final(): boolean {
        return this.isFinal
    }

    /**
     * Process an event and return a transition
     * Event handlers are methods named `on_${evtName}`
     */
    react(evtName: string, evtData: TEventData | null): Transition<TEventData, TResumePayload> {
        this.inited = true
        const expectedEvtHandlerMethodName = "on_" + evtName

        // Check if handler exists
        const handler = (this as Record<string, unknown>)[expectedEvtHandlerMethodName]
        if (handler === undefined) {
            throw new UnhandledEvtException(this.name, evtName)
        }

        // Call the handler
        let transition: Transition<TEventData, TResumePayload>
        if (evtData == null) {
            transition = (handler as () => Transition<TEventData, TResumePayload>).call(this)
        } else {
            transition = (handler as (data: TEventData) => Transition<TEventData, TResumePayload>).call(this, evtData)
        }

        // Validate the transition
        if (transition instanceof State) {
            return transition
        } else if (transition === undefined || transition === null || 
                   (typeof transition === 'string' && transition in SpecialTransition)) {
            return transition
        } else {
            throw new ImproperReactionException(this.name, evtName, typeof transition)
        }
    }
}

// ============================================================================
// FSM Class
// ============================================================================

export class FSM<TEventData, TResumePayload> {
    currState: State<TEventData, TResumePayload>
    readonly logger: Logger
    protected started: boolean
    protected smBusy: boolean
    protected deferralQueue: DeferredEvent<TEventData>[]

    constructor(startStateFetcher: () => State<TEventData, TResumePayload>, logger: Logger) {
        this.currState = startStateFetcher()
        this.logger = logger
        this.started = false
        this.smBusy = false
        this.deferralQueue = []
    }

    /** Called when an event is not handled. Override to customize behavior. */
    onUnconsumedEvt(exception: UnhandledEvtException): void {
        throw exception
    }

    /** Throws if FSM is not ready to handle events */
    protected checkIfFSMReadyToHandleEvt(): void {
        if (!this.started) {
            throw new SMInactiveException()
        } else if (this.currState.final()) {
            throw new FinalityReachedException()
        } else if (this.smBusy) {
            throw new RecursiveEventException()
        }
    }

    /** Send an event to the FSM */
    handleEvent(evtName: string, evtData: TEventData | null = null): void {
        this.checkIfFSMReadyToHandleEvt()
        this.processSingleEvent(evtName, evtData)
    }

    /** Walk up the state chain calling beforeExit on each */
    protected exitStateChain(state: State<TEventData, TResumePayload>): void {
        state.beforeExit()
        if (state instanceof SubState) {
            this.exitStateChain(state.parent)
        }
    }

    /** Process a single event and handle the resulting transition */
    protected processSingleEvent(evtName: string, evtData: TEventData | null): void {
        this.smBusy = true
        let transition: Transition<TEventData, TResumePayload> = undefined

        try {
            transition = this.currState.react(evtName, evtData)
        } catch (exception) {
            if (!(exception instanceof UnhandledEvtException)) {
                throw exception
            } else {
                this.onUnconsumedEvt(exception)
            }
        } finally {
            this.smBusy = false
        }

        // Handle the transition
        if (transition instanceof SubState) {
            // Entering a SubState: pause parent, enter substate
            this.currState.onPreemption()
            this.currState = transition
            this.handleStateEntry(this.currState)
        } else if (transition === SpecialTransition.ReturnToParent) {
            // SubState returning to parent
            if (!(this.currState instanceof SubState)) {
                throw new AFSMError("ReturnToParent used in non-SubState")
            }
            const payload = this.currState.getReturnPayload()
            this.currState.beforeExit()
            this.currState = this.currState.parent
            this.currState.onResumeFromSubstate(payload)
            this.processDeferralQueue()
        } else if (transition instanceof State) {
            // Regular state transition: exit entire chain, enter new state
            this.exitStateChain(this.currState)
            this.currState = transition
            this.handleStateEntry(this.currState)
        } else if (transition === SpecialTransition.deferralTransition) {
            this.deferralQueue.push([evtName, evtData])
        }
        // nullTransition or void: do nothing
    }

    /** Start the FSM */
    start(): void {
        this.started = true
        if (this.currState.final()) {
            throw new FinalityReachedException()
        }
        if (!this.currState.inited) {
            this.handleStateEntry(this.currState)
        }
    }

    /** Process all deferred events */
    processDeferralQueue(): void {
        if (this.deferralQueue.length === 0) {
            return
        }

        const local = this.deferralQueue
        this.deferralQueue = []

        for (const [evtName, evtData] of local) {
            try {
                this.checkIfFSMReadyToHandleEvt()
                this.processSingleEvent(evtName, evtData)
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                this.logger.warn(`Error while processing deferral queue: ${message}`)
            }
        }
    }

    /** Handle state entry: log, call onEntry, fire launch event, process deferred */
    protected handleStateEntry(state: State<TEventData, TResumePayload>): void {
        this.logger.info(`Entered "${state.constructor.name}" state`)
        state.onEntry()
        this.handleEvent("launch")
        this.processDeferralQueue()
    }
}

// ============================================================================
// SubState Class
// ============================================================================

export class SubState<TEventData, TReturnPayload> extends State<TEventData, TReturnPayload> {
    readonly parent: State<TEventData, TReturnPayload>

    constructor(parent: State<TEventData, TReturnPayload>) {
        super(false)
        this.parent = parent
    }

    /** Override to return a payload when returning to parent */
    getReturnPayload(): TReturnPayload | undefined {
        return undefined
    }

    /** Process event, bubble to parent if unhandled */
    react(evtName: string, evtData: TEventData | null): Transition<TEventData, TReturnPayload> {
        try {
            return super.react(evtName, evtData)
        } catch (err) {
            if (err instanceof UnhandledEvtException) {
                return this.parent.react(evtName, evtData)
            }
            throw err
        }
    }
}
