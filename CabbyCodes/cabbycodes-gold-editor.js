//=============================================================================
// CabbyCodes Party Gold Editor
//=============================================================================
/*:
 * @target MZ
 * @plugindesc Adds an Options entry for editing the party's gold value.
 * @author CabbyCodes
 * @help
 * Allows players to type a new gold amount inside the Options menu.
 * Values are clamped to the game's enforced gold limits.
 */

(() => {
    'use strict';
    
    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Gold editor requires CabbyCodes core.');
        return;
    }
    
    const settingKey = 'partyGoldAmount';
    const FALLBACK_MAX_GOLD = 99999999;
    
    /**
     * Attempts to resolve the party's maximum gold cap from game data.
     * @returns {number}
     */
    function resolveMaxGold() {
        if (typeof $gameParty !== 'undefined' && $gameParty && typeof $gameParty.maxGold === 'function') {
            return $gameParty.maxGold();
        }
        if (typeof Game_Party !== 'undefined' && Game_Party.prototype && typeof Game_Party.prototype.maxGold === 'function') {
            try {
                return Game_Party.prototype.maxGold.call({});
            } catch (error) {
                CabbyCodes.warn(`[CabbyCodes] Unable to probe maxGold: ${error?.message || error}`);
            }
        }
        return FALLBACK_MAX_GOLD;
    }
    
    const maxGold = resolveMaxGold();
    const maxGoldDigits = String(Math.abs(maxGold)).length;
    const maxGoldLabel = maxGold.toLocaleString();
    
    /**
     * Applies the requested gold value to the party.
     * @param {number} requestedValue
     */
    function applyGoldToParty(requestedValue) {
        if (typeof $gameParty === 'undefined' || !$gameParty || typeof $gameParty.gold !== 'function') {
            return;
        }
        const definition = CabbyCodes.getSettingDefinition(settingKey);
        const safeValue = CabbyCodes.normalizeSettingValue(definition, requestedValue);
        const currentGold = $gameParty.gold();
        if (safeValue === currentGold) {
            return;
        }
        const delta = safeValue - currentGold;
        $gameParty.gainGold(delta);
    }
    
    /**
     * Syncs the CabbyCodes setting from the current party gold.
     */
    function syncSettingFromParty() {
        if (typeof $gameParty === 'undefined' || !$gameParty || typeof $gameParty.gold !== 'function') {
            return;
        }
        CabbyCodes.setSetting(settingKey, $gameParty.gold());
    }
    
    CabbyCodes.registerSetting(settingKey, 'Party Gold', {
        type: 'number',
        order: 0,
        defaultValue: 0,
        min: 0,
        max: maxGold,
        maxDigits: maxGoldDigits,
        step: 100,
        inputTitle: 'Party Gold',
        inputDescription: `Enter an amount between 0 and ${maxGoldLabel}.`,
        formatValue: value => `${Number(value || 0).toLocaleString()} G`,
        onChange: newValue => {
            applyGoldToParty(newValue);
        }
    });
    
    // Keep the setting in sync whenever gold changes during play.
    CabbyCodes.after(Game_Party.prototype, 'gainGold', function() {
        CabbyCodes.setSetting(settingKey, this.gold());
    });
    
    // Sync once after starting a new game or loading a save.
    if (typeof DataManager !== 'undefined') {
        CabbyCodes.after(DataManager, 'setupNewGame', syncSettingFromParty);
        CabbyCodes.after(DataManager, 'extractSaveContents', syncSettingFromParty);
    }
    
    CabbyCodes.log('[CabbyCodes] Party gold editor loaded');
})();


