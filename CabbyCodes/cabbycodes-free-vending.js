//=============================================================================
// CabbyCodes Free Vending Machines
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Free Vending Machines - Skip coin costs for vending machines.
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that drops the price of vending machines to zero.
 * When enabled, vending interactions immediately jump to the purchase phase and
 * never demand coins.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Free Vending Machines requires CabbyCodes core.');
        return;
    }

    const settingKey = 'freeVendingMachines';
    const COST_VARIABLE_ID = 229;
    const isFeatureEnabled = () => CabbyCodes.getSetting(settingKey, false);
    
    // Use CabbyCodes.callOriginal if available, otherwise fall back to manual lookup
    const callOriginal = (typeof CabbyCodes.callOriginal === 'function')
        ? CabbyCodes.callOriginal
        : (target, functionName, context, args) => {
            const originals = target._cabbycodesOriginals;
            if (originals && typeof originals[functionName] === 'function') {
                return originals[functionName].apply(context, args);
            }
            return undefined;
        };

    /**
     * Returns the raw (unwrapped) value stored in $gameVariables._data.
     */
    function getRawVariableValue(varId) {
        if (
            typeof $gameVariables === 'undefined' ||
            !$gameVariables ||
            !Array.isArray($gameVariables._data)
        ) {
            return undefined;
        }
        return $gameVariables._data[varId];
    }

    /**
     * Forces the vending cost variable to zero when the feature is enabled.
     * @param {string} [reason]
     */
    function enforceZeroCost(reason) {
        if (!isFeatureEnabled()) {
            return;
        }
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return;
        }
        const rawValue = getRawVariableValue(COST_VARIABLE_ID);
        if (rawValue === 0 || typeof rawValue === 'undefined') {
            return;
        }
        try {
            $gameVariables.setValue(COST_VARIABLE_ID, 0);
            CabbyCodes.debug?.(
                `[CabbyCodes] Free vending: clamped cost to zero${reason ? ` (${reason})` : ''}`
            );
        } catch (error) {
            CabbyCodes.warn(
                `[CabbyCodes] Free vending failed to clamp cost variable: ${error?.message || error}`
            );
        }
    }

    /**
     * Reapplies the Game_Variables overrides so we stay at the end of the patch chain
     * even if other plugins override those methods later during startup.
     */
    function applyVariableHooks() {
        CabbyCodes.override(
            Game_Variables.prototype,
            'setValue',
            function(variableId, value) {
                const numericId = Number(variableId);
                let nextValue = value;

                if (numericId === COST_VARIABLE_ID && isFeatureEnabled()) {
                    nextValue = 0;
                }

                return callOriginal(Game_Variables.prototype, 'setValue', this, [
                    variableId,
                    nextValue
                ]);
            }
        );

        CabbyCodes.override(
            Game_Variables.prototype,
            'value',
            function(variableId) {
                const numericId = Number(variableId);
                if (numericId === COST_VARIABLE_ID && isFeatureEnabled()) {
                    return 0;
                }

                return callOriginal(Game_Variables.prototype, 'value', this, [
                    variableId
                ]);
            }
        );
    }

    function hookInterpreterVariableOps() {
        CabbyCodes.after(
            Game_Interpreter.prototype,
            'operateVariable',
            function(variableId) {
                if (!isFeatureEnabled()) {
                    return;
                }
                const numericId = Number(variableId);
                if (numericId === COST_VARIABLE_ID) {
                    enforceZeroCost('operateVariable');
                }
            }
        );
    }

    applyVariableHooks();
    hookInterpreterVariableOps();
    if (typeof Scene_Boot !== 'undefined') {
        CabbyCodes.after(Scene_Boot.prototype, 'start', function() {
            applyVariableHooks();
            enforceZeroCost('Scene_Boot.start');
        });
    }

    CabbyCodes.registerSetting(
        settingKey,
        'Free Vending Machines',
        {
            defaultValue: false,
            order: 62
        },
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Free vending machines ${newValue ? 'enabled' : 'disabled'}`
            );
            if (newValue) {
                enforceZeroCost('setting toggled on');
            }
        }
    );

    CabbyCodes.log('[CabbyCodes] Free Vending Machines module loaded');
})();


