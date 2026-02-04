export class AFSMError extends Error{
    constructor(message){
        super(message)
        this.name = this.constructor.name 
    }
}

export class FinalityReachedException extends AFSMError
{
    constructor(){
        super("State machine has reched final state and can't process any new events")
    }
}

export class SMInactiveException extends AFSMError
{
    constructor(){
	    super("State machine needs to be started by calling the start() method")
        this.name = "SMInactiveException"
    }
}

export class UnhandledEvtException extends AFSMError
{
    constructor(stateName, evtName){
	    super(`Event: ${evtName} is unhandled in state: ${stateName}`)
    }
}

export class ImproperReactionException extends AFSMError
{
    constructor(stateName, evtName, reactionType){
	    super(`Improper reaction from state: ${stateName}, while handling event: ${evtName}, the reaction should be either a new state or a member of "SpecialTransition", but the type of the reaction was of type: ${reactionType}`)
    }
}

export class RecursiveEventException extends AFSMError
{
    constructor(){
	    super(`Raising and event on FSM while it is already processing an event`)
    }
}

export const SpecialTransition = 
{
	nullTransition : "nullTransition",
    undefined : "nullTransition",
    null : "nullTransition",
	deferralTransition : "deferralTransition",
	ReturnToParent : "ReturnToParent"
};

export class State
{
	constructor(isFinal = false){
        this.isFinal = isFinal
        this.name = this.constructor.name
        this.inited = false
        this.activeSubState = null
    }

    on_launch() { return SpecialTransition.nullTransition }
	onEntry() { }
	beforeExit() {}
	onPreemption() { }
	onResumeFromSubstate(payload) { }
	final(){ return this.isFinal }
    react(evtName, evtData)
    {
        this.inited = true
        let expectedEvtHandlerMethodName = "on_" + evtName
        if(this[expectedEvtHandlerMethodName] == undefined)
            throw new UnhandledEvtException(this.name, evtName)

        let transition = null
        if(evtData == null){
            transition = (this[expectedEvtHandlerMethodName])()
        }
        else{
            transition = (this[expectedEvtHandlerMethodName])(evtData)
        }
        
        if (transition instanceof State){
            return transition
        }
        else if (SpecialTransition[transition] != undefined){
            return transition
        }
        else{
            throw new ImproperReactionException(this.name, evtName, typeof transition)
        }
    }
}

export class FSM
{
	constructor(startStateFetcher, logger)
	{
        this.currState = startStateFetcher()
        this.logger = logger
        this.started = false
        this.smBusy = false//FSM is bust processing an evt
        this.deferralQueue = []
    }

    onUnconsumedEvt(exception) {
        throw exception
    }

    checkIfFSMReadyToHandleEvt(){
        if (!this.started)
            throw new SMInactiveException()
        else if (this.currState.final())
            throw new FinalityReachedException()
        else if(this.smBusy)
            throw new RecursiveEventException()
    }

	handleEvent(evtName, evtData = null)
	{
        this.checkIfFSMReadyToHandleEvt()
        this.processSingleEvent(evtName, evtData)
	}

    exitStateChain(state) {
        state.beforeExit()
        if (state instanceof SubState) {
            this.exitStateChain(state.parent)
        }
    }

    processSingleEvent(evtName, evtData){
        this.smBusy = true
        let transition = null
        try{
            transition = this.currState.react(evtName, evtData)
        }
        catch(exception) {
            if(!(exception instanceof UnhandledEvtException)){
                throw exception
            } else{
                this.onUnconsumedEvt(exception)
            }
        }
        finally{
            this.smBusy = false
        }

        this.smBusy = false
        if (transition instanceof SubState) {
            // Entering a SubState: pause parent, enter substate
            this.currState.onPreemption()
            this.currState = transition
            this.handleStateEntry(this.currState)
        }
        else if (transition === SpecialTransition.ReturnToParent) {
            // SubState returning to parent
            const payload = this.currState.getReturnPayload()
            this.currState.beforeExit()
            this.currState = this.currState.parent
            this.currState.onResumeFromSubstate(payload)
            this.processDeferralQueue()
        }
        else if (transition instanceof State) {
            // Regular state transition: exit entire chain, enter new state
            this.exitStateChain(this.currState)
            this.currState = transition
            this.handleStateEntry(this.currState)
        }
        else if (SpecialTransition.deferralTransition == transition) {
            this.deferralQueue.push([evtName, evtData])
        }
    }

	start()
	{
		this.started = true
        if (this.currState.final())
            throw new FinalityReachedException()
        if (!this.currState.inited)
            this.handleStateEntry(this.currState)
	}

	processDeferralQueue(){
        if (0 == this.deferralQueue.length){
            return
        }

		let local = this.deferralQueue
        this.deferralQueue = []

		for (let i = 0; i < local.length; i++){
            try{
                this.checkIfFSMReadyToHandleEvt()
                let [evtName, evtData] = local[i]
                this.processSingleEvent(evtName, evtData)
            }
            catch(err){
                this.logger.warn(`Error while processing deferral queue: ${err.message}`)
            }
		}
	}
	
	handleStateEntry(state){
        this.logger.info(`Entered "${state.constructor.name}" state`)
		state.onEntry()
        this.handleEvent("launch")
		this.processDeferralQueue()
	}
};

export class SubState extends State
{
	constructor(parent)
	{
        super(false)
        this.parent = parent
    }

	getReturnPayload() { return undefined }

	react(evtName, evtData) {
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

export class CompositeState extends State
{
	constructor(logger,
                isFinal = false)
	{
        super(isFinal)
        this.startStateFetcher = () => this
        this.fsm = null
        this.logger = logger
    }

    initiateExit(){
        if (this.fsm !== null) {
            if(this.fsm.currState instanceof CompositeState){
                this.fsm.currState.initiateExit()
            }
            this.fsm.currState.beforeExit()
        }
    }

    react(name, evtData)
    {
        let transition = null
        try{
            
            transition = super.react(name, evtData)
        }catch(err){
            if(err instanceof UnhandledEvtException){
                if (this.fsm == null){
                    this.fsm = new FSM(this.startStateFetcher, this.logger)
                    this.fsm.start()
                }
                try {
                    this.fsm.handleEvent(name, evtData)
                }
                catch (err) {
                    if (!(err instanceof FinalityReachedException)) {
                        throw err
                    }
                }
                transition = SpecialTransition.nullTransition
            } else {
                throw err
            }

        }finally{
            if(transition instanceof State){
                this.initiateExit()
                return transition
            }
        }

        
    }
}