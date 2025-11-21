//=============================================================================
// CabbyCodes Refill Status
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Refill Status - One-press HP/MP + needs refill
 * @author CabbyCodes
 * @help
 * Adds a "Refill Status" press-style option to the CabbyCodes section of the
 * Options menu. Selecting it instantly restores every party member to full HP
 * and MP (if they are below their current maximums) and tops off all hidden
 * need meters such as hunger, energy, hygiene, morale, calm, social, and the
 * breath-odor tracker.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Refill Status requires the core module.');
        return;
    }

    const settingKey = 'refillStatus';
    const SETTINGS_SYMBOL = `cabbycodes_${settingKey}`;
    const HIDDEN_NEED_VARIABLES = [
        { id: 21, maxValue: 100, label: 'Social' },
        { id: 22, maxValue: 100, label: 'Calm' },
        { id: 23, maxValue: 100, label: 'Energy' },
        { id: 24, maxValue: 100, label: 'Hunger' },
        { id: 25, maxValue: 100, label: 'Hygiene' },
        { id: 26, maxValue: 100, label: 'Morale' },
        { id: 117, maxValue: 100, targetValue: 0, label: 'Breath Odor' }
    ];
    const MAX_VALUE_FALLBACK = 100;
    const REFILL_TOLERANCE = 1e-4;
    const CONFIRMATION_TEXT =
        'WARNING:\n' +
        'This instantly restores HP/MP for every party member and fills all hidden needs.\n' +
        'Proceed?';

    CabbyCodes.registerSetting(settingKey, 'Refill Status', {
        defaultValue: false,
        order: 5,
        formatValue: () => 'Press',
        onChange: newValue => {
            if (!newValue) {
                return;
            }
            const result = attemptRefillStatus();
            if (typeof $gameMessage !== 'undefined' && $gameMessage.add) {
                $gameMessage.add(result.message);
            }
            CabbyCodes.setSetting(settingKey, false);
        }
    });

    /**
     * Retrieves the current playable party members.
     * @returns {Game_Actor[]}
     */
    function getPartyMembers() {
        if (typeof $gameParty === 'undefined' || !$gameParty) {
            return [];
        }
        if (typeof $gameParty.allMembers === 'function') {
            return $gameParty.allMembers().filter(Boolean);
        }
        if (typeof $gameParty.members === 'function') {
            return $gameParty.members().filter(Boolean);
        }
        return [];
    }

    /**
     * Restores HP/MP for every party member currently below max.
     * @returns {{hpRestored: number, mpRestored: number}}
     */
    function refillPartyMembers() {
        const members = getPartyMembers();
        let hpRestored = 0;
        let mpRestored = 0;
        for (const actor of members) {
            if (!isGameActor(actor)) {
                continue;
            }
            if (shouldRestoreHp(actor)) {
                actor.setHp(actor.mhp);
                hpRestored += 1;
            }
            if (shouldRestoreMp(actor)) {
                actor.setMp(actor.mmp);
                mpRestored += 1;
            }
        }
        return { hpRestored, mpRestored };
    }

    /**
     * Sets all hidden need variables to their configured maximum.
     * @returns {number} How many variables were adjusted
     */
    function refillHiddenNeeds() {
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            CabbyCodes.warn('[CabbyCodes] Refill Status: $gameVariables unavailable.');
            return 0;
        }
        if (typeof $gameVariables.setValue !== 'function' || typeof $gameVariables.value !== 'function') {
            CabbyCodes.warn('[CabbyCodes] Refill Status: $gameVariables accessors missing.');
            return 0;
        }
        let updated = 0;
        for (const stat of HIDDEN_NEED_VARIABLES) {
            const targetValue = determineTargetValue(stat);
            const currentValue = toNumber($gameVariables.value(stat.id));
            if (shouldUpdateNeed(currentValue, targetValue)) {
                $gameVariables.setValue(stat.id, targetValue);
                updated += 1;
            }
        }
        return updated;
    }

    /**
     * Wraps the refill action in error handling so both the options button
     * and manual setting toggles can share the same logic.
     * @returns {{success: boolean, message: string}}
     */
    function attemptRefillStatus() {
        try {
            const partyResult = refillPartyMembers();
            const needsUpdated = refillHiddenNeeds();
            const message = formatRefillSummary(partyResult, needsUpdated);
            CabbyCodes.log(`[CabbyCodes] ${message}`);
            return { success: true, message };
        } catch (error) {
            const message = `Refill Status failed: ${error?.message || error}`;
            CabbyCodes.error(`[CabbyCodes] ${message}`);
            return { success: false, message };
        }
    }

    /**
     * Builds a friendly summary string for logs and user messaging.
     * @param {{hpRestored: number, mpRestored: number}} partyResult
     * @param {number} needsUpdated
     * @returns {string}
     */
    function formatRefillSummary(partyResult, needsUpdated) {
        const hpPart = `${partyResult.hpRestored} actor${partyResult.hpRestored === 1 ? '' : 's'} HP-restored`;
        const mpPart = `${partyResult.mpRestored} actor${partyResult.mpRestored === 1 ? '' : 's'} MP-restored`;
        const needsPart = `${needsUpdated} hidden need${needsUpdated === 1 ? '' : 's'} maxed`;
        return `Refill Status applied: ${hpPart}, ${mpPart}, ${needsPart}.`;
    }

    function isGameActor(actor) {
        return (
            actor &&
            typeof actor.isActor === 'function' &&
            actor.isActor() &&
            typeof actor.setHp === 'function' &&
            typeof actor.setMp === 'function'
        );
    }

    function shouldRestoreHp(actor) {
        const maxHp = toNumber(actor?.mhp);
        return maxHp > 0 && toNumber(actor?.hp) < maxHp;
    }

    function shouldRestoreMp(actor) {
        const maxMp = toNumber(actor?.mmp);
        return maxMp > 0 && toNumber(actor?.mp) < maxMp;
    }

    function toNumber(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : 0;
    }

    function determineTargetValue(stat) {
        if (Number.isFinite(stat.targetValue)) {
            return stat.targetValue;
        }
        if (Number.isFinite(stat.maxValue)) {
            return stat.maxValue;
        }
        return MAX_VALUE_FALLBACK;
    }

    function shouldUpdateNeed(currentValue, targetValue) {
        if (!Number.isFinite(currentValue)) {
            return true;
        }
        return Math.abs(currentValue - targetValue) > REFILL_TOLERANCE;
    }

    /**
     * Opens the confirmation scene from the options window.
     */
    function openRefillConfirmationScene() {
        if (
            typeof SceneManager === 'undefined' ||
            typeof SceneManager.push !== 'function'
        ) {
            CabbyCodes.warn(
                '[CabbyCodes] SceneManager unavailable; cannot open Refill confirmation.'
            );
            return;
        }
        if (typeof Scene_CabbyCodesRefillConfirm === 'undefined') {
            CabbyCodes.warn(
                '[CabbyCodes] Confirmation scene missing; cannot perform Refill.'
            );
            return;
        }
        SceneManager.push(Scene_CabbyCodesRefillConfirm);
    }

    /**
     * Hooks Window_Options to treat the Refill option as a press-style button
     * that launches the confirmation scene before applying changes.
     * @returns {boolean}
     */
    function setupRefillProcessOkHook() {
        if (typeof Window_Options === 'undefined') {
            return false;
        }
        if (Window_Options.prototype._cabbycodesRefillProcessOkHookInstalled) {
            return true;
        }
        const previousProcessOk = Window_Options.prototype.processOk;
        if (typeof previousProcessOk !== 'function') {
            return false;
        }
        Window_Options.prototype.processOk = function() {
            const symbol = this.commandSymbol(this.index());
            if (symbol === SETTINGS_SYMBOL) {
                openRefillConfirmationScene();
                return;
            }
            previousProcessOk.call(this);
        };
        Window_Options.prototype._cabbycodesRefillProcessOkHookInstalled = true;
        return true;
    }

    if (!setupRefillProcessOkHook()) {
        const hookInterval = setInterval(() => {
            if (setupRefillProcessOkHook()) {
                clearInterval(hookInterval);
            }
        }, 10);
        setTimeout(() => {
            clearInterval(hookInterval);
            if (
                !Window_Options ||
                !Window_Options.prototype._cabbycodesRefillProcessOkHookInstalled
            ) {
                CabbyCodes.warn(
                    '[CabbyCodes] Failed to hook Window_Options for Refill Status within 5 seconds.'
                );
            }
        }, 5000);
    }

    //----------------------------------------------------------------------
    // Confirmation Scene
    //----------------------------------------------------------------------

    function Scene_CabbyCodesRefillConfirm() {
        this.initialize(...arguments);
    }

    window.Scene_CabbyCodesRefillConfirm = Scene_CabbyCodesRefillConfirm;

    Scene_CabbyCodesRefillConfirm.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesRefillConfirm.prototype.constructor = Scene_CabbyCodesRefillConfirm;

    Scene_CabbyCodesRefillConfirm.prototype.helpAreaHeight = function() {
        return 0;
    };

    Scene_CabbyCodesRefillConfirm.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createInfoWindow();
        this.createCommandWindow();
    };

    Scene_CabbyCodesRefillConfirm.prototype.createInfoWindow = function() {
        const rect = this.infoWindowRect();
        const uiApi = CabbyCodes.ui || {};
        const factory =
            typeof uiApi.createInfoBox === 'function'
                ? uiApi.createInfoBox
                : rectParam => new Window_CabbyCodesRefillInfo(rectParam);
        this._infoWindow = factory(rect, CONFIRMATION_TEXT);
        if (this._infoWindow && typeof this._infoWindow.setText === 'function') {
            this._infoWindow.setText(CONFIRMATION_TEXT);
        }
        this.addWindow(this._infoWindow);
    };

    Scene_CabbyCodesRefillConfirm.prototype.infoWindowRect = function() {
        const ww = Math.min(Graphics.boxWidth - 96, 640);
        const wx = (Graphics.boxWidth - ww) / 2;
        const wy = this.buttonAreaBottom() + 12;
        const wh = this.calcWindowHeight(3, false);
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_CabbyCodesRefillConfirm.prototype.createCommandWindow = function() {
        const rect = this.commandWindowRect();
        this._commandWindow = new Window_CabbyCodesRefillConfirm(rect);
        this._commandWindow.setHandler('confirm', this.onConfirm.bind(this));
        this._commandWindow.setHandler('cancel', this.popScene.bind(this));
        this.addWindow(this._commandWindow);
    };

    Scene_CabbyCodesRefillConfirm.prototype.commandWindowRect = function() {
        const ww = 360;
        const wh = this.calcWindowHeight(2, true);
        const wx = (Graphics.boxWidth - ww) / 2;
        const spacing = 18;
        const baseY = this._infoWindow
            ? this._infoWindow.y + this._infoWindow.height + spacing
            : this.buttonAreaBottom() + spacing;
        const maxY = Graphics.boxHeight - wh - spacing;
        const wy = Math.min(baseY, maxY);
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_CabbyCodesRefillConfirm.prototype.onConfirm = function() {
        const result = attemptRefillStatus();
        if (typeof $gameMessage !== 'undefined' && $gameMessage.add) {
            $gameMessage.add(result.message);
        }
        SceneManager.pop();
    };

    //----------------------------------------------------------------------
    // Confirmation Window
    //----------------------------------------------------------------------

    function Window_CabbyCodesRefillConfirm() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesRefillConfirm.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesRefillConfirm.prototype.constructor = Window_CabbyCodesRefillConfirm;

    Window_CabbyCodesRefillConfirm.prototype.makeCommandList = function() {
        this.addCommand('Yes, refill everything', 'confirm');
        this.addCommand('No, go back', 'cancel');
    };

    //----------------------------------------------------------------------
    // Fallback info window for confirmation text
    //----------------------------------------------------------------------

    function Window_CabbyCodesRefillInfo() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesRefillInfo.prototype = Object.create(Window_Base.prototype);
    Window_CabbyCodesRefillInfo.prototype.constructor = Window_CabbyCodesRefillInfo;

    Window_CabbyCodesRefillInfo.prototype.initialize = function(rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this._text = '';
    };

    Window_CabbyCodesRefillInfo.prototype.setText = function(text) {
        const normalized = String(text || '');
        if (this._text === normalized) {
            return;
        }
        this._text = normalized;
        this.refresh();
    };

    Window_CabbyCodesRefillInfo.prototype.refresh = function() {
        if (!this.contents) {
            this.createContents();
        }
        this.contents.clear();
        this.resetFontSettings();
        const lines = String(this._text || '').split(/\r?\n/);
        const maxWidth = this.contentsWidth();
        let y = 0;
        lines.forEach(line => {
            this.drawText(line, 0, y, maxWidth);
            y += this.lineHeight();
        });
    };

    CabbyCodes.log('[CabbyCodes] Refill Status module loaded');
})();


