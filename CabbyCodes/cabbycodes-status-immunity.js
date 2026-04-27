//=============================================================================
// CabbyCodes Status Immunity
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Status Immunity - Prevent negative status effects on party actors
 * @author CabbyCodes
 * @help
 * Adds a "Status Immunity" toggle to the Options menu. When enabled, actors in
 * the player's party cannot be affected by negative status effects (states that
 * restrict actions, reduce parameters, or cause other harmful effects).
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Status Immunity requires CabbyCodes core.');
        return;
    }

    const settingKey = 'statusImmunityEnabled';

    CabbyCodes.registerSetting(
        settingKey,
        'Status Immunity',
        {
            defaultValue: false,
            order: 90
        },
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Status Immunity ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    const isStatusImmunityActive = () => CabbyCodes.getSetting(settingKey, false);

    /**
     * Determines if the battler belongs to the player's party. The Massacre
     * Princess carve-out (see CabbyCodes.isMassacrePrincessForm in
     * cabbycodes-session-state.js) drops protection from the MP supporting
     * cast during the Visitor final battle; without it, the Unconscious
     * state (id 1, restriction 4) would be blocked here and they'd survive
     * at 0 HP after Invincibility correctly let them take the lethal hit.
     * @param {Game_BattlerBase} battler
     * @returns {boolean}
     */
    function isProtectedActor(battler) {
        if (!battler || typeof battler.isActor !== 'function' || !battler.isActor()) {
            return false;
        }
        if (typeof $gameParty === 'undefined' || !$gameParty) {
            return false;
        }
        let inParty = false;
        if (typeof $gameParty.allMembers === 'function') {
            inParty = $gameParty.allMembers().includes(battler);
        } else if (typeof $gameParty.members === 'function') {
            inParty = $gameParty.members().includes(battler);
        }
        if (!inParty) {
            return false;
        }
        if (typeof CabbyCodes.isMassacrePrincessForm === 'function' && CabbyCodes.isMassacrePrincessForm()) {
            const id = typeof battler.actorId === 'function' ? battler.actorId() : battler._actorId;
            return id === CabbyCodes.MASSACRE_PRINCESS_RUSH_ACTOR_ID || id === CabbyCodes.PRIMARY_ACTOR_ID;
        }
        return true;
    }

    /**
     * Determines if a state is negative (harmful).
     * A state is considered negative if it:
     * - Restricts actions (restriction > 0) - most common indicator
     * - Has negative parameter modifications via traits
     * - Uses a debuff icon (heuristic: iconIndex >= 48)
     * @param {number} stateId
     * @returns {boolean}
     */
    function isNegativeState(stateId) {
        if (!stateId || !$dataStates || !$dataStates[stateId]) {
            return false;
        }

        const state = $dataStates[stateId];
        
        // Death state (ID 1) is typically handled by invincibility,
        // but we can block it here too for complete status immunity
        
        // Primary check: if state restricts actions, it's almost certainly negative
        // Restriction levels: 0 = none, 1 = attack enemy, 2 = attack anyone, 3 = attack ally, 4 = cannot act
        if (state.restriction > 0) {
            return true;
        }

        // Secondary check: look for negative parameter modifications in traits
        if (state.traits && Array.isArray(state.traits)) {
            for (const trait of state.traits) {
                if (!trait || typeof trait.code !== 'number') {
                    continue;
                }
                
                // Check for negative parameter modifications (TRAIT_PARAM = 21)
                if (trait.code === Game_BattlerBase.TRAIT_PARAM) {
                    // Values < 100 indicate parameter reduction
                    if (trait.value < 100) {
                        return true;
                    }
                }
                // Check for negative X-parameters (TRAIT_XPARAM = 22)
                // X-params: hit rate, evasion, etc. (0-1.0 range typically)
                if (trait.code === Game_BattlerBase.TRAIT_XPARAM && trait.value < 0) {
                    return true;
                }
                // Check for negative S-parameters (TRAIT_SPARAM = 23)
                // S-params: critical rate, etc. (0-1.0 range typically)
                if (trait.code === Game_BattlerBase.TRAIT_SPARAM && trait.value < 0) {
                    return true;
                }
            }
        }

        // Tertiary check: debuff icon heuristic
        // In RPG Maker MZ, debuff icons typically start at index 48
        // This is not 100% reliable but helps catch states that might not restrict actions
        if (state.iconIndex >= 48 && state.iconIndex < 64) {
            return true;
        }

        // Default: allow the state (conservative approach)
        // Most positive states have restriction = 0 and positive parameter modifications
        return false;
    }

    /**
     * Safely calls the original implementation stored by CabbyCodes.override().
     * @param {Object} targetPrototype
     * @param {string} functionName
     * @param {Object} context
     * @param {Array} args
     * @returns {*}
     */
    function callOriginal(targetPrototype, functionName, context, args) {
        const originals = targetPrototype._cabbycodesOriginals;
        if (originals && typeof originals[functionName] === 'function') {
            return originals[functionName].apply(context, args);
        }
        return undefined;
    }

    /**
     * Override addState to prevent negative states from being added to protected actors.
     */
    CabbyCodes.override(
        Game_Battler.prototype,
        'addState',
        function(stateId) {
            // If status immunity is active and this is a protected actor
            if (isStatusImmunityActive() && isProtectedActor(this)) {
                // Check if the state is negative
                if (isNegativeState(stateId)) {
                    // Prevent the state from being added
                    CabbyCodes.debug(`[CabbyCodes] Blocked negative state ${stateId} from ${this.name() || 'actor'}`);
                    return;
                }
            }
            // Otherwise, call the original function
            return callOriginal(Game_Battler.prototype, 'addState', this, [stateId]);
        }
    );

    /**
     * Also override isStateAddable to prevent negative states from being considered addable
     * for protected actors. This provides an additional layer of protection.
     */
    CabbyCodes.override(
        Game_Battler.prototype,
        'isStateAddable',
        function(stateId) {
            // First check the original conditions
            const originalResult = callOriginal(Game_Battler.prototype, 'isStateAddable', this, [stateId]);
            if (!originalResult) {
                return false;
            }

            // If status immunity is active and this is a protected actor
            if (isStatusImmunityActive() && isProtectedActor(this)) {
                // Check if the state is negative
                if (isNegativeState(stateId)) {
                    // State is not addable for protected actors
                    return false;
                }
            }

            return true;
        }
    );

    CabbyCodes.log('[CabbyCodes] Status Immunity module loaded');
})();

