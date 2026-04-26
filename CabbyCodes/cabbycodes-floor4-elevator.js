//=============================================================================
// CabbyCodes Floor 4 Elevator
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Floor 4 Elevator - Keeps the apartment elevator's hidden Floor 4 choice always visible.
 * @author CabbyCodes
 * @help
 * The apartment elevator at Map074 (`DoorElevator`) hides a "Floor 4" choice
 * behind a `WD_ConditionalChoice` directive that reads var 817
 * (`elevatorGame`): the choice text is `(([v[817]<4]))Floor 4`, meaning the
 * option is hidden whenever var 817 is below 4. The natural game advances
 * var 817 through 0 -> 1 -> 2 -> 3 -> 4 only when the player picks the
 * floors in a specific secret sequence (Ground Floor -> Floor 3 -> Floor 1
 * -> Floor 2). Picking any wrong floor resets var 817 back to 0.
 *
 * When this cheat is enabled, every write to var 817 that would drop it
 * below 4 is overridden to 4 instead, so the hidden Floor 4 choice stays
 * permanently available regardless of which floors the player picks.
 * Toggling the cheat ON also bumps var 817 to 4 immediately so the player
 * does not have to ride the elevator once before Floor 4 unlocks.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Floor 4 Elevator requires CabbyCodes core.');
        return;
    }

    const SETTING_KEY = 'floor4Elevator';
    const LOG_PREFIX = '[CabbyCodes][Floor4]';

    // Var 817 (`elevatorGame`) is the elevator-quest sequence counter. The
    // only read site in the entire game data is the `(([v[817]<4]))Floor 4`
    // hide-gate on Map074 ev2 (verified by enumerating all `v[817]` and
    // raw-817 references across CommonEvents, Map*.json, Troops.json, and
    // System.json — every other "817" hit is a skill / dataId in an
    // unrelated context). So pinning the variable at >= 4 has no other
    // game-side side effects.
    const ELEVATOR_VAR_ID = 817;
    const FLOOR4_GATE_VALUE = 4;

    let interceptorRegistered = false;

    CabbyCodes.registerSetting(
        SETTING_KEY,
        'Floor 4 Always Available',
        {
            defaultValue: false,
            order: 88
        },
        newValue => {
            CabbyCodes.log(`${LOG_PREFIX} Floor 4 ${newValue ? 'unlocked' : 'released'}.`);
            if (newValue) {
                bumpElevatorVarIfBelowGate();
            }
        }
    );

    const isCheatEnabled = () => CabbyCodes.getSetting(SETTING_KEY, false);

    function bumpElevatorVarIfBelowGate() {
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return;
        }
        if (typeof CabbyCodes.isGameSessionActive === 'function'
                && !CabbyCodes.isGameSessionActive()) {
            return;
        }
        const current = Number($gameVariables.value(ELEVATOR_VAR_ID));
        if (Number.isFinite(current) && current >= FLOOR4_GATE_VALUE) {
            return;
        }
        // The interceptor (registered below) will see this write through
        // the freeze-time setValue override and pass it through unchanged
        // since the new value is at the gate. No exempt token is needed
        // because var 817 is not in the freeze-time FROZEN_VARIABLE_IDS
        // list and the freeze snapshot/restore loop ignores it.
        $gameVariables.setValue(ELEVATOR_VAR_ID, FLOOR4_GATE_VALUE);
        CabbyCodes.warn(`${LOG_PREFIX} var ${ELEVATOR_VAR_ID} bumped ${current} -> ${FLOOR4_GATE_VALUE}.`);
    }

    // Interceptor: any natural-game write that targets var 817 with a value
    // below 4 (typical "wrong floor picked, reset sequence" branch) gets
    // raised to 4 so the elevator's hide-gate never re-triggers.
    function elevatorInterceptor(varId, _previousValue, pendingValue) {
        if (!isCheatEnabled() || varId !== ELEVATOR_VAR_ID) {
            return;
        }
        const numeric = Number(pendingValue);
        if (Number.isFinite(numeric) && numeric < FLOOR4_GATE_VALUE) {
            return { value: FLOOR4_GATE_VALUE };
        }
        return undefined;
    }

    function tryRegisterInterceptor() {
        if (interceptorRegistered) {
            return true;
        }
        const api = CabbyCodes.freezeTime;
        if (!api || typeof api.registerVariableWriteInterceptor !== 'function') {
            return false;
        }
        api.registerVariableWriteInterceptor(elevatorInterceptor);
        interceptorRegistered = true;
        return true;
    }

    // freeze-time loads earlier in CabbyCodes.js's scripts[] array (index ~33
    // vs this module sitting later), so the API is normally up by now. The
    // setTimeout fallback handles edge cases where load order shifts.
    if (!tryRegisterInterceptor()) {
        setTimeout(() => {
            if (!tryRegisterInterceptor()) {
                CabbyCodes.warn(`${LOG_PREFIX} freeze-time API unavailable; interceptor not registered.`);
            }
        }, 0);
    }

    CabbyCodes.log('[CabbyCodes] Floor 4 elevator module loaded');
})();
