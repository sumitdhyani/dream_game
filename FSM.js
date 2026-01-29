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
	deferralTransition : "deferralTransition"
};

export class State
{
	constructor(isFinal = false){
        this.isFinal = isFinal
        this.name = this.constructor.name
    }

    on_launch() { return SpecialTransition.nullTransition }
	onEntry() { }
	beforeExit() {}
	final(){ return this.isFinal }
    react(evtName, evtData)
    {
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
        if(transition instanceof State){
            this.currState.beforeExit()
            this.currState = transition
            this.handleStateEntry(this.currState)
        }
        else if(SpecialTransition.deferralTransition == transition){
            this.deferralQueue.push([evtName, evtData])
        }
    }

	start()
	{
		this.started = true
        if (this.currState.final())
            throw new FinalityReachedException()
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

export class CompositeState extends State
{
	constructor(startStateFetcher, 
                logger,
                isFinal = false)
	{
        super(isFinal)
        this.fsm = new FSM(startStateFetcher, logger)
    }

    initiateExit(){
        if(this.fsm.currState instanceof CompositeState){
            this.fsm.currState.initiateExit()
        }
        
        this.fsm.currState.beforeExit()
    }

    react(name, evtData)
    {
        let transition = null
        try{
            
            transition = super.react(name, evtData)
        }
        catch(err){
            if(!(err instanceof UnhandledEvtException)){
                throw err
            }
        }finally{
            if(0 === name.localeCompare('launch')){
                this.fsm.start()
                if(transition instanceof State){
                    this.initiateExit()
                    return transition
                }
                return
            }else if(transition instanceof State){
                this.initiateExit()
                return transition
            }
        }

        try{
            this.fsm.handleEvent(name, evtData)
        }
        catch(err){
            if(!(err instanceof FinalityReachedException)){
                throw err
            }
        }
        return SpecialTransition.nullTransition
    }
}