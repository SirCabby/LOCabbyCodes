//=============================================================================
// CabbyCodes Oven Navigation
//=============================================================================
/*:
 * @target MZ
 * @plugindesc Adds touch-friendly back buttons to the oven ingredient selector.
 * @author CabbyCodes
 * @help
 * This plugin adds explicit "Back" buttons to the oven ingredient selection
 * windows so players can leave the cooking flow using the mouse or touch
 * controls. The button appears when choosing either the first or second
 * ingredient and mirrors the behaviour of pressing the cancel key.
 *
 * Features:
 * - Always-on back button for the first ingredient list.
 * - Back button for the second ingredient list that also clears the first pick.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Oven Navigation requires the core module.');
        return;
    }
    if (typeof Window_EventItem === 'undefined' || typeof Scene_Message === 'undefined') {
        console.warn('[CabbyCodes] Oven Navigation requires Window_EventItem and Scene_Message.');
        return;
    }

    const MODULE_LABEL = '[CabbyCodes][OvenNav]';
    const PRIMARY_VAR_ID = 74;
    const SECONDARY_VAR_ID = 75;
    const BUTTON_RECT = Object.freeze({
        width: 132,
        height: 40,
        margin: 12
    });
    const BUTTON_LABELS = Object.freeze({
        primary: 'Back',
        secondary: 'Back'
    });
    const WD_SCENE_CLASS_NAME = 'Scene_WdItems';
    const WD_PLUGIN_NAME = 'WD_ItemUse';
    const COOKING_CONTROL_EVENT_ID = 42;
    const COOKING_COOK_EVENT_ID = 44;
    const COOKING_SECONDARY_EVENT_ID = 45;
    const COOKING_EVENT_IDS = new Set([
        COOKING_CONTROL_EVENT_ID,
        COOKING_COOK_EVENT_ID,
        COOKING_SECONDARY_EVENT_ID
    ]);
    const COOKING_RESTART_EVENT_ID = COOKING_COOK_EVENT_ID;
    const PRIMARY_CALL_ARGS = {
        linebreak: 'Settings ===',
        itemSelector: '{"selectorMode":"mode5","includeEquip":"mode1","metaTag":"69"}',
        showDesc: 'mode1',
        returnMode: '{"returnMode":"mode0","idVar":"70","catVar":"71","resultSwitch":"15"}'
    };
    const PRIMARY_RETURN_MODE = JSON.parse(PRIMARY_CALL_ARGS.returnMode || '{}');
    const WD_RESULT_SWITCH_ID = Number(PRIMARY_RETURN_MODE.resultSwitch || 0) || 0;

    const ENABLE_DEBUG_LOGS = false;
    const interpreterTracker = {
        restartQueued: false,
        primaryInterpreter: null,
        controlInterpreter: null
    };
    let activeCookingInterpreter = null;
    const abortLabelCache = new Map();

    initializeLogger();
    hookSceneMessage();
    hookEventItemWindow();
    initializeWdSceneHook();
    installInterpreterHooks();

    CabbyCodes.log?.('[CabbyCodes] Oven navigation helpers loaded');

    function initializeLogger() {
        debugLog('Oven navigation module initialized; debug logging active.');
    }

    function debugLog(...args) {
        if (!ENABLE_DEBUG_LOGS) {
            return;
        }
        try {
            const message = `${MODULE_LABEL} ${args.join(' ')}`;
            if (typeof CabbyCodes !== 'undefined' && typeof CabbyCodes.log === 'function') {
                CabbyCodes.log(message);
            } else {
                console.log(message);
            }
        } catch (error) {
            console.log(`${MODULE_LABEL} Failed to log message`, error);
        }
    }

    function isFeatureEnabled() {
        return true;
    }

    function resolveChoiceVariableId() {
        if (typeof $gameMessage === 'undefined' || !$gameMessage.itemChoiceVariableId) {
            return null;
        }
        const varId = $gameMessage.itemChoiceVariableId();
        return typeof varId === 'number' ? varId : null;
    }

    function resolveContextFromVar(varId) {
        if (varId === PRIMARY_VAR_ID) {
            return 'primary';
        }
        if (varId === SECONDARY_VAR_ID) {
            return 'secondary';
        }
        return null;
    }

    function hookSceneMessage() {
        CabbyCodes.after(Scene_Message.prototype, 'createEventItemWindow', function() {
            this.createCabbyCodesOvenBackButton();
        });

        Scene_Message.prototype.createCabbyCodesOvenBackButton = function() {
            if (this._cabbycodesOvenBackButton) {
                return;
            }
            const button = new CabbyCodesOvenBackButtonWindow();
            button.visible = false;
            button.setClickHandler(() => this.cabbycodesHandleOvenBackPress());
            this._cabbycodesOvenBackButton = button;
            this.addWindow(button);
            debugLog('Created Scene_Message oven back button');
        };

        Scene_Message.prototype.cabbycodesHandleOvenBackPress = function() {
            if (!this._eventItemWindow) {
                return;
            }
            triggerOvenBackAction(this._eventItemWindow, null, { fromButton: true });
        };

        Scene_Message.prototype.showCabbyCodesOvenBackButton = function(context) {
            if (!this._cabbycodesOvenBackButton) {
                this.createCabbyCodesOvenBackButton();
            }
            const labelKey = context === 'secondary' ? 'secondary' : 'primary';
            const button = this._cabbycodesOvenBackButton;
            button.setLabel(BUTTON_LABELS[labelKey]);
            button.resetPointerState();
            button.visible = true;
            this._cabbycodesCurrentOvenContext = context;
            debugLog('Showing event item back button', `context=${context}`);
            this.positionCabbyCodesOvenBackButton();
        };

        Scene_Message.prototype.hideCabbyCodesOvenBackButton = function() {
            if (this._cabbycodesOvenBackButton) {
                this._cabbycodesOvenBackButton.visible = false;
                this._cabbycodesOvenBackButton.resetPointerState();
            }
            this._cabbycodesCurrentOvenContext = null;
        };

        Scene_Message.prototype.positionCabbyCodesOvenBackButton = function() {
            const button = this._cabbycodesOvenBackButton;
            const targetWindow = this._eventItemWindow;
            if (!button || !button.visible || !targetWindow) {
                return;
            }
            const margin = BUTTON_RECT.margin;
            const maxX = Graphics.boxWidth - button.width - margin;
            let x = targetWindow.x + targetWindow.width - button.width - margin;
            x = Math.max(margin, Math.min(maxX, x));

            const preferredTop = targetWindow.y - button.height - margin;
            if (preferredTop >= margin) {
                button.y = preferredTop;
            } else {
                const blockY = this._messageWindow ? this._messageWindow.y : Graphics.boxHeight;
                const candidate = targetWindow.y + targetWindow.height + margin;
                const limit = blockY - button.height - margin;
                button.y = Math.max(margin, Math.min(candidate, limit));
            }
            button.x = x;
        };

        CabbyCodes.after(Scene_Message.prototype, 'update', function() {
            if (this._cabbycodesOvenBackButton?.visible) {
                this.positionCabbyCodesOvenBackButton();
            }
        });
    }

    function hookEventItemWindow() {
        CabbyCodes.after(Window_EventItem.prototype, 'start', function() {
            this._cabbycodesOvenChoiceVarId = resolveChoiceVariableId();
            this._cabbycodesOvenContext = resolveContextFromVar(this._cabbycodesOvenChoiceVarId);

            if (!isFeatureEnabled() || !this._cabbycodesOvenContext) {
                hideEventSceneButton();
                return;
            }
            debugLog('Window_EventItem start', `context=${this._cabbycodesOvenContext}`);
            showEventSceneButton(this._cabbycodesOvenContext);
        });

        CabbyCodes.after(Window_EventItem.prototype, 'close', function() {
            hideEventSceneButton();
        });

        CabbyCodes.after(Window_EventItem.prototype, 'onOk', function() {
            hideEventSceneButton();
        });

        CabbyCodes.before(Window_EventItem.prototype, 'onCancel', function() {
            this._cabbycodesCancelHandled = false;
            if (!isFeatureEnabled()) {
                return;
            }
            const context = this._cabbycodesOvenContext || resolveContextFromVar(resolveChoiceVariableId());
            if (context === 'secondary' && typeof $gameVariables !== 'undefined') {
                $gameVariables.setValue(PRIMARY_VAR_ID, 0);
                $gameVariables.setValue(SECONDARY_VAR_ID, 0);
                debugLog('Window_EventItem cancel (pre) resetting ingredient vars');
            }
        });

        CabbyCodes.after(Window_EventItem.prototype, 'onCancel', function() {
            if (this._cabbycodesOvenContext === 'secondary' && !this._cabbycodesCancelHandled) {
                debugLog('Window_EventItem cancel -> handleSecondaryBacktrack');
                handleSecondaryBacktrack();
            }
            this._cabbycodesCancelHandled = false;
            hideEventSceneButton();
        });

        CabbyCodes.after(Window_EventItem.prototype, 'updatePlacement', function() {
            if (this._cabbycodesOvenContext) {
                positionEventSceneButton();
            }
        });
    }

    function showEventSceneButton(context) {
        const scene = SceneManager._scene;
        if (scene && typeof scene.showCabbyCodesOvenBackButton === 'function') {
            scene.showCabbyCodesOvenBackButton(context);
        }
    }

    function hideEventSceneButton() {
        const scene = SceneManager._scene;
        if (scene && typeof scene.hideCabbyCodesOvenBackButton === 'function') {
            scene.hideCabbyCodesOvenBackButton();
        }
    }

    function positionEventSceneButton() {
        const scene = SceneManager._scene;
        if (scene && typeof scene.positionCabbyCodesOvenBackButton === 'function') {
            scene.positionCabbyCodesOvenBackButton();
        }
    }

    function initializeWdSceneHook() {
        if (initializeWdSceneHook._initialized) {
            return;
        }
        initializeWdSceneHook._initialized = true;
        monitorWdScene();
    }

    function installInterpreterHooks() {
        if (installInterpreterHooks._initialized) {
            return;
        }
        if (
            typeof Game_Interpreter === 'undefined' ||
            typeof Game_Temp === 'undefined'
        ) {
            setTimeout(installInterpreterHooks, 250);
            return;
        }
        installInterpreterHooks._initialized = true;

        const originalSetupReservedCommonEvent =
            Game_Interpreter.prototype.setupReservedCommonEvent;
        Game_Interpreter.prototype.setupReservedCommonEvent = function() {
            if ($gameTemp.isCommonEventReserved()) {
                const commonEvent = $gameTemp.retrieveCommonEvent();
                if (commonEvent) {
                    markInterpreterAsCooking(this, commonEvent.id || 0, commonEvent.list);
                    this.setup(commonEvent.list);
                    return true;
                }
            }
            return false;
        };

        const originalCommand117 = Game_Interpreter.prototype.command117;
        Game_Interpreter.prototype.command117 = function() {
            const result = originalCommand117.apply(this, arguments);
            if (this._childInterpreter) {
                const commonEventId = Array.isArray(this._params)
                    ? Number(this._params[0] || 0)
                    : 0;
                const commonEvent = $dataCommonEvents?.[commonEventId];
                markInterpreterAsCooking(this._childInterpreter, commonEventId, commonEvent?.list || null);
            }
            return result;
        };

        const originalClear = Game_Interpreter.prototype.clear;
        Game_Interpreter.prototype.clear = function() {
            if (activeCookingInterpreter === this) {
                debugLog('Clearing active cooking interpreter');
                activeCookingInterpreter = null;
            }
            return originalClear.apply(this, arguments);
        };
    }


    function monitorWdScene() {
        if (typeof SceneManager === 'undefined') {
            setTimeout(monitorWdScene, 250);
            return;
        }
        const sceneClass = SceneManager[WD_SCENE_CLASS_NAME];
        if (!sceneClass || !sceneClass.prototype) {
            setTimeout(monitorWdScene, 500);
            return;
        }
        const proto = sceneClass.prototype;
        if (proto._cabbycodesOvenNavDecorated) {
            return;
        }
        CabbyCodes.after(proto, 'createWdItemWindow', function() {
            setTimeout(() => setupWdSceneNavigation(this), 0);
        });
        CabbyCodes.after(proto, 'update', function() {
            if (this._cabbycodesOvenBackButton?.visible) {
                positionWdSceneButton(this);
            }
        });
        CabbyCodes.after(proto, 'terminate', function() {
            hideWdSceneButton(this);
        });
        CabbyCodes.override(proto, 'onWdItemCancel', function() {
            const context = resolveContextFromWindow(this._wdItemWindow);
            const requestedContext = this._cabbycodesBackRequest;
            const effectiveContext = requestedContext || context;
            if (isFeatureEnabled() && effectiveContext === 'secondary') {
                debugLog('Intercepted WD cancel for secondary context.');
                this._cabbycodesBackRequest = null;
                processWdSecondaryCancel(this);
                return;
            }
            if (this._cabbycodesCancelSuppressed) {
                this._cabbycodesCancelSuppressed = false;
            }
            const original = this._cabbycodesOriginals?.onWdItemCancel;
            if (typeof original === 'function') {
                original.apply(this, arguments);
            }
        });
        proto._cabbycodesOvenNavDecorated = true;
    }

    function setupWdSceneNavigation(sceneInstance) {
        if (!sceneInstance) {
            return;
        }
        if (!isFeatureEnabled()) {
            hideWdSceneButton(sceneInstance);
            return;
        }
        const windowInstance = sceneInstance._wdItemWindow;
        const context = resolveContextFromWindow(windowInstance);
        if (!windowInstance || !context) {
            hideWdSceneButton(sceneInstance);
            return;
        }
        const button = ensureWdSceneButton(sceneInstance);
        const labelKey = context === 'secondary' ? 'secondary' : 'primary';
        button.setLabel(BUTTON_LABELS[labelKey]);
        button.resetPointerState();
        button.visible = true;
        debugLog('Decorated WD scene window', `context=${context}`, `items=${sceneInstance._wdItemWindow?._cabbycodesWdList?.length ?? 0}`);
        positionWdSceneButton(sceneInstance);
    }

    function ensureWdSceneButton(sceneInstance) {
        if (sceneInstance._cabbycodesOvenBackButton) {
            return sceneInstance._cabbycodesOvenBackButton;
        }
        const button = new CabbyCodesOvenBackButtonWindow();
        button.visible = false;
        button.setClickHandler(() => triggerWdSceneBack(sceneInstance));
        sceneInstance._cabbycodesOvenBackButton = button;
        sceneInstance.addWindow(button);
        return button;
    }

    function triggerWdSceneBack(sceneInstance) {
        if (!sceneInstance) {
            return;
        }
        sceneInstance._cabbycodesCancelSuppressed = true;
        const windowInstance = sceneInstance._wdItemWindow;
        const context = resolveContextFromWindow(windowInstance);
        triggerOvenBackAction(windowInstance, context, { fromButton: true, sceneInstance });
    }

    function positionWdSceneButton(sceneInstance) {
        if (!sceneInstance) {
            return;
        }
        const button = sceneInstance._cabbycodesOvenBackButton;
        const windowInstance = sceneInstance._wdItemWindow;
        if (!button || !button.visible || !windowInstance) {
            return;
        }
        const margin = BUTTON_RECT.margin;
        const maxX = Graphics.boxWidth - button.width - margin;
        let x = windowInstance.x + windowInstance.width - button.width - margin;
        x = Math.max(margin, Math.min(maxX, x));

        const descWindowY = sceneInstance._wdItemDescWindow
            ? sceneInstance._wdItemDescWindow.y
            : Graphics.boxHeight;
        const preferredTop = windowInstance.y - button.height - margin;
        let y;
        if (preferredTop >= margin) {
            y = preferredTop;
        } else {
            const candidate = windowInstance.y + windowInstance.height + margin;
            const limit = descWindowY - button.height - margin;
            y = Math.max(margin, Math.min(candidate, limit));
        }

        button.x = x;
        button.y = y;
    }

    function hideWdSceneButton(sceneInstance = SceneManager?._scene) {
        if (sceneInstance && sceneInstance._cabbycodesOvenBackButton) {
            sceneInstance._cabbycodesOvenBackButton.visible = false;
            sceneInstance._cabbycodesOvenBackButton.resetPointerState();
        }
    }

    function triggerOvenBackAction(windowInstance, explicitContext = null, options = null) {
        if (!windowInstance) {
            return;
        }
        const context = explicitContext || resolveContextFromWindow(windowInstance);
        const isSecondary = context === 'secondary';
        debugLog(
            'triggerOvenBackAction',
            `window=${windowInstance.constructor?.name ?? '<unknown>'}`,
            `context=${context}`,
            `fromButton=${options?.fromButton ? 'yes' : 'no'}`
        );
        const sceneInstance = options?.sceneInstance;
        if (sceneInstance && sceneInstance.constructor?.name === WD_SCENE_CLASS_NAME) {
            handleWdBackRequest(sceneInstance, context);
            return;
        }
        if (isSecondary && typeof $gameVariables !== 'undefined') {
            $gameVariables.setValue(PRIMARY_VAR_ID, 0);
            $gameVariables.setValue(SECONDARY_VAR_ID, 0);
        }
        if (typeof SoundManager !== 'undefined' && SoundManager.playCancel) {
            SoundManager.playCancel();
        }
        windowInstance._cabbycodesCancelHandled = true;
        const skipWindowHandlers = sceneInstance && sceneInstance.constructor?.name === WD_SCENE_CLASS_NAME;
        let cancelHandled = handleSceneCancel(sceneInstance);
        if (!cancelHandled && !skipWindowHandlers && typeof windowInstance.isHandled === 'function' && windowInstance.isHandled('cancel')) {
            try {
                windowInstance.callCancelHandler();
                cancelHandled = true;
            } catch (error) {
                debugLog('Window cancel handler threw via callCancelHandler', error?.message || error);
            }
        }
        if (!cancelHandled && !skipWindowHandlers && typeof windowInstance.onCancel === 'function') {
            try {
                windowInstance.onCancel();
                cancelHandled = true;
            } catch (error) {
                debugLog('Window cancel handler threw via onCancel', error?.message || error);
            }
        }
        if (!cancelHandled) {
            debugLog('No cancel handler available on oven window; skipping close fallback.');
        }
        if (isSecondary) {
            handleSecondaryBacktrack();
        }
    }

    function resolveContextFromWindow(windowInstance) {
        if (!windowInstance) {
            return null;
        }
        if (windowInstance._cabbycodesOvenContext) {
            return windowInstance._cabbycodesOvenContext;
        }
        if (windowInstance._cabbycodesWdContext?.mode) {
            return windowInstance._cabbycodesWdContext.mode;
        }
        const choiceVarId =
            windowInstance._cabbycodesOvenChoiceVarId !== undefined
                ? windowInstance._cabbycodesOvenChoiceVarId
                : resolveChoiceVariableId();
        return resolveContextFromVar(choiceVarId);
    }

    function handleSecondaryBacktrack() {
        debugLog('handleSecondaryBacktrack invoked');
        const abortSucceeded = abortCookingCommonEvent();
        if (!abortSucceeded) {
            debugLog('Primary abort path failed; attempting forced interpreter clear.');
            if (!forceAbortCookingEvent()) {
                debugLog('Forced abort failed; no interpreter to clear. Falling back to event restart.');
                queueCookingRestart();
                return;
            }
        }
        interpreterTracker.restartQueued = false;
        restartCookingControlFlow();
    }

    function abortCookingCommonEvent() {
        const success = forceAbortCookingEvent();
        if (!success) {
            debugLog('abortCookingCommonEvent failed; interpreter not set');
        }
        return success;
    }

    function identifyCommonEventContext(interpreter, list) {
        if (!interpreter) {
            return;
        }
        const eventId = interpreter._cabbycodesCommonEventId;
        const eventList =
            interpreter._cabbycodesOriginalList ||
            list ||
            interpreter._cabbycodesEventListRef ||
            (eventId ? $dataCommonEvents?.[eventId]?.list : null);
        if (!COOKING_EVENT_IDS.has(eventId) || !eventList) {
            if (activeCookingInterpreter === interpreter) {
                activeCookingInterpreter = null;
            }
            interpreter._cabbycodesCommonEventId = 0;
            interpreter._cabbycodesEventListRef = null;
            interpreter._cabbycodesOriginalList = null;
            interpreter._cabbycodesOriginalEventId = null;
            return;
        }
        interpreter._cabbycodesEventListRef = eventList;
        activeCookingInterpreter = interpreter;
        if (eventId === COOKING_CONTROL_EVENT_ID && interpreter._depth === 0) {
            interpreterTracker.primaryInterpreter = interpreter;
            interpreterTracker.controlInterpreter = interpreter;
        }
        interpreterTracker.restartQueued = false;
        debugLog(
            'Tracking cooking interpreter (setup path)',
            `eventId=${eventId}`,
            `depth=${interpreter._depth || 0}`,
            `commands=${eventList.length}`
        );
    }

    function queueCookingRestart() {
        if (
            interpreterTracker.restartQueued ||
            typeof $gameTemp === 'undefined' ||
            typeof $gameTemp.reserveCommonEvent !== 'function'
        ) {
            debugLog(
                'queueCookingRestart skipped',
                `pending=${interpreterTracker.restartQueued}`,
                `$gameTemp=${typeof $gameTemp !== 'undefined'}`
            );
            return;
        }
        interpreterTracker.restartQueued = true;
        $gameTemp.reserveCommonEvent(COOKING_RESTART_EVENT_ID);
        debugLog('queueCookingRestart scheduled common event', `eventId=${COOKING_RESTART_EVENT_ID}`);
    }

    function markInterpreterAsCooking(interpreter, commonEventId, list = null) {
        if (!interpreter || !COOKING_EVENT_IDS.has(commonEventId)) {
            return;
        }
        interpreter._cabbycodesCommonEventId = commonEventId;
        if (
            !interpreter._cabbycodesOriginalList ||
            interpreter._cabbycodesOriginalEventId !== commonEventId
        ) {
            const seededList = fetchCookingCommandList(commonEventId) || cloneCommandList(list);
            if (seededList) {
                interpreter._cabbycodesOriginalList = seededList;
                interpreter._cabbycodesOriginalEventId = commonEventId;
            }
        }
        const resolvedList =
            interpreter._cabbycodesOriginalList ||
            cloneCommandList(list) ||
            interpreter._cabbycodesEventListRef ||
            fetchCookingCommandList(commonEventId) ||
            null;
        if (Array.isArray(resolvedList)) {
            interpreter._cabbycodesEventListRef = resolvedList;
        }
        identifyCommonEventContext(interpreter, resolvedList);
        if (commonEventId === COOKING_CONTROL_EVENT_ID) {
            interpreterTracker.controlInterpreter = interpreter;
            interpreterTracker.primaryInterpreter = interpreter;
        } else if (!interpreterTracker.primaryInterpreter) {
            interpreterTracker.primaryInterpreter = interpreter;
        }
    }

    function gatherInterpreterRoots(initialRoot = null) {
        const roots = [];
        const candidates = [
            initialRoot,
            $gameMap?._interpreter,
            SceneManager._scene?._interpreter,
            interpreterTracker.controlInterpreter,
            interpreterTracker.primaryInterpreter,
            activeCookingInterpreter
        ];
        for (const candidate of candidates) {
            if (candidate && !roots.includes(candidate)) {
                roots.push(candidate);
            }
        }
        return roots;
    }

    function locateControlInterpreter() {
        if (interpreterTracker.controlInterpreter) {
            return interpreterTracker.controlInterpreter;
        }
        const roots = gatherInterpreterRoots();
        for (const root of roots) {
            let current = root;
            while (current) {
                if (current._cabbycodesCommonEventId === COOKING_CONTROL_EVENT_ID) {
                    interpreterTracker.controlInterpreter = current;
                    return current;
                }
                current = current._childInterpreter;
            }
        }
        return null;
    }

    function findCookingInterpreterById(eventId) {
        if (!COOKING_EVENT_IDS.has(eventId)) {
            return null;
        }
        const roots = gatherInterpreterRoots();
        for (const root of roots) {
            let current = root;
            while (current) {
                if (current._cabbycodesCommonEventId === eventId) {
                    return current;
                }
                current = current._childInterpreter;
            }
        }
        return null;
    }

    function locateCookingInterpreter(root = $gameMap?._interpreter) {
        const control = locateControlInterpreter();
        if (control) {
            return control;
        }
        const roots = gatherInterpreterRoots(root);
        for (const candidateRoot of roots) {
            let current = candidateRoot;
            while (current) {
                if (current._cabbycodesCommonEventId === COOKING_CONTROL_EVENT_ID) {
                    interpreterTracker.controlInterpreter = current;
                    return current;
                }
                if (COOKING_EVENT_IDS.has(current._cabbycodesCommonEventId)) {
                    return current;
                }
                current = current._childInterpreter;
            }
        }
        return interpreterTracker.primaryInterpreter || null;
    }

    function forceAbortCookingEvent() {
        const interpreter = locateCookingInterpreter();
        if (!interpreter) {
            return false;
        }
        interpreter.clear();
        activeCookingInterpreter = null;
        if (interpreterTracker.primaryInterpreter === interpreter) {
            interpreterTracker.primaryInterpreter = null;
        }
        if (interpreterTracker.controlInterpreter === interpreter) {
            interpreterTracker.controlInterpreter = null;
        }
        interpreter._cabbycodesOriginalEventId = null;
        interpreter._cabbycodesOriginalList = null;
        debugLog('Forced cooking interpreter clear.');
        return true;
    }

    function ensureInterpreterList(interpreter) {
        if (!interpreter) {
            return;
        }
        const targetList =
            interpreter._cabbycodesOriginalList ||
            interpreter._cabbycodesEventListRef ||
            fetchCookingCommandList(interpreter._cabbycodesCommonEventId || COOKING_CONTROL_EVENT_ID);
        if (targetList && interpreter._list !== targetList) {
            interpreter._list = targetList;
            interpreter._mapId = 0;
            interpreter._eventId = interpreter._cabbycodesCommonEventId || COOKING_CONTROL_EVENT_ID;
            interpreter._branch = interpreter._branch || [];
            debugLog('Interpreter list realigned to cooking event list');
        }
    }

    function CabbyCodesOvenBackButtonWindow() {
        this.initialize(...arguments);
    }

    CabbyCodesOvenBackButtonWindow.prototype = Object.create(Window_Command.prototype);
    CabbyCodesOvenBackButtonWindow.prototype.constructor = CabbyCodesOvenBackButtonWindow;

    CabbyCodesOvenBackButtonWindow.prototype.initialize = function() {
        const rect = new Rectangle(0, 0, this.windowWidth(), this.windowHeight());
        this._label = BUTTON_LABELS.primary;
        this._cabbycodesPressed = false;
        Window_Command.prototype.initialize.call(this, rect);
        this.cursorOpacity = 0;
        this.visible = false;
    };

    CabbyCodesOvenBackButtonWindow.prototype.windowWidth = function() {
        return BUTTON_RECT.width;
    };

    CabbyCodesOvenBackButtonWindow.prototype.windowHeight = function() {
        return this.fittingHeight(1);
    };

    CabbyCodesOvenBackButtonWindow.prototype.maxCols = function() {
        return 1;
    };

    CabbyCodesOvenBackButtonWindow.prototype.makeCommandList = function() {
        this.addCommand(this._label, 'back');
    };

    CabbyCodesOvenBackButtonWindow.prototype.updateCursor = function() {
        this.setCursorRect(0, 0, 0, 0);
    };

    CabbyCodesOvenBackButtonWindow.prototype.setLabel = function(label) {
        if (!label || this._label === label) {
            return;
        }
        this._label = label;
        this.refresh();
    };

    CabbyCodesOvenBackButtonWindow.prototype.setClickHandler = function(handler) {
        this.setHandler('back', handler);
        this.setHandler('ok', handler);
    };

    CabbyCodesOvenBackButtonWindow.prototype.resetPointerState = function() {
        this._cabbycodesPressed = false;
    };

    CabbyCodesOvenBackButtonWindow.prototype.update = function() {
        Window_Command.prototype.update.call(this);
        this.processPointer();
    };

    CabbyCodesOvenBackButtonWindow.prototype.processPointer = function() {
        if (!this.visible) {
            this._cabbycodesPressed = false;
            return;
        }
        const inside = this.isTouchedInsideFrame();
        if (inside && TouchInput.isTriggered()) {
            this._cabbycodesPressed = true;
        }
        if (this._cabbycodesPressed && TouchInput.isReleased()) {
            this._cabbycodesPressed = false;
            if (inside && this.isHandled('back')) {
                if (typeof SoundManager !== 'undefined' && SoundManager.playCursor) {
                    SoundManager.playCursor();
                }
                this.callHandler('back');
            }
        }
        if (!TouchInput.isPressed()) {
            this._cabbycodesPressed = false;
        }
    };

    function handleSceneCancel(sceneInstance) {
        if (!sceneInstance || sceneInstance.constructor?.name !== WD_SCENE_CLASS_NAME) {
            return false;
        }
        const wdWindow = ensureWdWindowStub(sceneInstance, '_wdItemWindow');
        const wdDesc = ensureWdWindowStub(sceneInstance, '_wdItemDescWindow');
        wrapWindowClose(wdWindow);
        wrapWindowClose(wdDesc);
        if (!sceneInstance._cabbycodesWdPatched) {
            patchWdUncloseableWindow(sceneInstance);
            sceneInstance._cabbycodesWdPatched = true;
        }
        if (sceneInstance._cabbycodesCancelSuppressed) {
            return true;
        }
        sceneInstance._cabbycodesCancelSuppressed = true;
        if (WD_RESULT_SWITCH_ID > 0 && typeof $gameSwitches !== 'undefined' && $gameSwitches.setValue) {
            $gameSwitches.setValue(WD_RESULT_SWITCH_ID, false);
        }
        if (typeof sceneInstance.popScene === 'function') {
            try {
                sceneInstance.popScene();
            } catch (error) {
                debugLog('Failed to pop WD scene', error?.message || error);
            }
        } else if (typeof SceneManager.popScene === 'function') {
            SceneManager.popScene();
        }
        return true;
    }

    function patchWdUncloseableWindow(sceneInstance) {
        if (!sceneInstance || typeof Scene_MenuBase !== 'function') {
            return;
        }
        const sceneProto = Object.getPrototypeOf(sceneInstance);
        if (sceneProto._cabbycodesWdClosePatched) {
            return;
        }
        sceneProto._cabbycodesWdClosePatched = true;
        const originalCreateWdItemWindow = sceneProto.createWdItemWindow;
        sceneProto.createWdItemWindow = function() {
            originalCreateWdItemWindow.apply(this, arguments);
            const windowInstance = this._wdItemWindow;
            if (windowInstance) {
                wrapWindowClose(windowInstance);
            }
            if (this._wdItemDescWindow) {
                wrapWindowClose(this._wdItemDescWindow);
            }
        };
        const originalTerminate = sceneProto.terminate;
        sceneProto.terminate = function() {
            if (this._wdItemWindow) {
                wrapWindowClose(this._wdItemWindow);
            }
            if (this._wdItemDescWindow) {
                wrapWindowClose(this._wdItemDescWindow);
            }
            if (typeof originalTerminate === 'function') {
                originalTerminate.apply(this, arguments);
            }
        };
    }

    function wrapWindowClose(windowInstance) {
        if (!windowInstance || windowInstance._cabbycodesCloseWrapped) {
            return;
        }
        windowInstance._cabbycodesCloseWrapped = true;
        const originalClose = windowInstance.close;
        windowInstance.close = function() {
            if (typeof originalClose === 'function') {
                originalClose.apply(this, arguments);
            }
        };
    }

    function handleWdBackRequest(sceneInstance, context) {
        if (!sceneInstance) {
            return false;
        }
        sceneInstance._cabbycodesBackRequest = context;
        const windowInstance = sceneInstance._wdItemWindow;
        if (windowInstance && typeof windowInstance.callCancelHandler === 'function') {
            windowInstance.callCancelHandler();
        } else {
            processWdSecondaryCancel(sceneInstance);
        }
        return true;
    }

    function processWdSecondaryCancel(sceneInstance) {
        if (!sceneInstance) {
            return;
        }
        sceneInstance._cabbycodesCancelSuppressed = true;
        if (typeof SoundManager !== 'undefined' && SoundManager.playCancel) {
            SoundManager.playCancel();
        }
        if (WD_RESULT_SWITCH_ID > 0 && typeof $gameSwitches !== 'undefined' && $gameSwitches.setValue) {
            $gameSwitches.setValue(WD_RESULT_SWITCH_ID, false);
        }
        const aborted = forceAbortCookingEvent();
        if (!aborted) {
            debugLog('processWdSecondaryCancel fallback: interpreter not found, queuing restart only.');
        }
        restartCookingControlFlow();
        sceneInstance._cabbycodesBackRequest = null;
        if (SceneManager._scene === sceneInstance) {
            SceneManager.pop();
        }
    }

    function restartCookingControlFlow() {
        interpreterTracker.restartQueued = false;
    }

    function fetchCookingCommandList(eventId) {
        if (!COOKING_EVENT_IDS.has(eventId)) {
            return null;
        }
        const sourceList = $dataCommonEvents?.[eventId]?.list;
        return cloneCommandList(sourceList);
    }

    function cloneCommandList(commands) {
        if (!Array.isArray(commands)) {
            return null;
        }
        return commands.map(command => {
            if (!command || typeof command !== 'object') {
                return command;
            }
            return {
                code: command.code,
                indent: command.indent,
                parameters: cloneDeep(command.parameters)
            };
        });
    }

    function cloneDeep(value) {
        if (Array.isArray(value)) {
            return value.map(cloneDeep);
        }
        if (value && typeof value === 'object') {
            const result = {};
            for (const key in value) {
                if (Object.prototype.hasOwnProperty.call(value, key)) {
                    result[key] = cloneDeep(value[key]);
                }
            }
            return result;
        }
        return value;
    }

    function ensureWdWindowStub(sceneInstance, key) {
        if (!sceneInstance) {
            return;
        }
        let windowInstance = sceneInstance[key];
        if (!windowInstance) {
            windowInstance = { close() {} };
            sceneInstance[key] = windowInstance;
        } else if (typeof windowInstance.close !== 'function') {
            windowInstance.close = function() {};
        }
        return windowInstance;
    }
})();


