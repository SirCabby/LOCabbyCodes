//=============================================================================
// CabbyCodes Vanilla Bug Fix
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Vanilla Bug Fix - Submenu of toggles for base-game bug patches.
 * @author CabbyCodes
 * @help
 * Adds a press entry to the Cheats menu that opens a submenu of toggles,
 * each patching a specific bug in the base game.
 *
 * Currently bundled:
 *   - Safe-Hits Reset on Weapon Break. Vanilla durabilityCheck() captures
 *     `equip = subject._equips[0]` then calls forceChangeEquip on break,
 *     which mutates the same Game_Item via setObject(). The trailing
 *     `atkCntArray[equip._itemId] = attackCount` therefore writes 0 into
 *     the *replacement* weapon's slot, leaving the broken weapon ID's
 *     counter at its high value. A second instance of the same weapon
 *     type then inherits that stale counter and breaks immediately.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Vanilla Bug Fix requires CabbyCodes core.');
        return;
    }

    // Top-level press entry shown in the Cheats menu. Distinct from any
    // sub-toggle storage key so vanilla Window_Options cursorRight (which
    // unconditionally writes `true` to a boolean symbol) cannot accidentally
    // flip a sub-fix when arrow-keying past the press row.
    const MENU_KEY = 'vanillaBugFixMenu';
    const LOG_PREFIX = '[CabbyCodes][VanillaBugFix]';

    // Variable 162 stores the per-weapon-id attack count array used by
    // durabilityCheck() to compute the safeHits grace.
    const ATTACK_COUNT_VAR_ID = 162;

    // Sub-fix toggles are stored directly via get/setSetting and are NOT
    // registerSetting'd, so they only render inside this module's submenu
    // and do not appear as top-level rows in the Cheats menu.
    //
    // The Safe-Hits Reset toggle keeps the legacy `vanillaBugFix` key so
    // existing user preferences carry over unchanged after the menu split.
    const FIXES = [
        {
            key: 'vanillaBugFix',
            label: 'Safe-Hits Reset on Weapon Break',
            defaultValue: false
        }
    ];

    const PICKER_WIDTH = 520;
    const PICKER_SPACING = 12;
    const PICKER_MAX_ROWS = 8;

    CabbyCodes.registerSetting(MENU_KEY, 'Vanilla Bug Fix', {
        defaultValue: 0,
        order: 60,
        formatValue: () => 'Press',
        onActivate: () => {
            openPickerScene();
            return true;
        }
    });

    function isFixEnabled(key) {
        const fix = FIXES.find(f => f.key === key);
        const def = fix ? fix.defaultValue : false;
        return Boolean(CabbyCodes.getSetting(key, def));
    }

    function setFixEnabled(key, value) {
        CabbyCodes.setSetting(key, Boolean(value));
    }

    function openPickerScene() {
        if (typeof SceneManager === 'undefined' || typeof Scene_CabbyCodesVanillaBugFix === 'undefined') {
            CabbyCodes.warn(`${LOG_PREFIX} SceneManager or picker scene unavailable.`);
            return;
        }
        SceneManager.push(Scene_CabbyCodesVanillaBugFix);
    }

    //----------------------------------------------------------------------
    // durabilityCheck patch (gated by the Safe-Hits Reset sub-toggle)
    //----------------------------------------------------------------------

    /**
     * Mirrors the subject-resolution logic at the top of vanilla
     * durabilityCheck() so we can read the actor's currently equipped weapon
     * around the original call.
     * @returns {Object|null}
     */
    function resolveDurabilitySubject() {
        let subject = (typeof window.gVr === 'function') ? window.gVr(148) : null;
        if (!subject || subject === 0) {
            subject = window.BattleManager && window.BattleManager._lastSubject;
        }
        return subject || null;
    }

    function equippedWeaponId(subject) {
        const slot = subject && subject._equips && subject._equips[0];
        return (slot && slot._itemId) || 0;
    }

    /**
     * After delegating to the original, detect a break by comparing the
     * equipped weapon ID before vs after, and zero the broken ID's slot
     * explicitly so a fresh copy of the same weapon type starts at full
     * safe hits.
     */
    function resetBrokenWeaponSafeHits(preWeaponId, preSubject) {
        if (preWeaponId <= 0) {
            return;
        }
        try {
            const postSubject = preSubject || resolveDurabilitySubject();
            const postWeaponId = postSubject ? equippedWeaponId(postSubject) : 0;
            if (postWeaponId === preWeaponId) {
                return;
            }
            if (typeof window.gVr !== 'function' || typeof window.sVr !== 'function') {
                return;
            }
            const counts = window.gVr(ATTACK_COUNT_VAR_ID);
            if (!Array.isArray(counts) || preWeaponId >= counts.length) {
                return;
            }
            counts[preWeaponId] = 0;
            window.sVr(ATTACK_COUNT_VAR_ID, counts);
            CabbyCodes.log(`${LOG_PREFIX} Reset safe hits for broken weapon ${preWeaponId}`);
        } catch (error) {
            CabbyCodes.warn(`${LOG_PREFIX} Safe-hits reset failed: ${error?.message || error}`);
        }
    }

    if (typeof window.durabilityCheck !== 'function') {
        CabbyCodes.warn(`${LOG_PREFIX} Could not find durabilityCheck(); safe-hits reset not applied.`);
        return;
    }

    CabbyCodes.override(window, 'durabilityCheck', function(...args) {
        if (!isFixEnabled('vanillaBugFix')) {
            return CabbyCodes.callOriginal(window, 'durabilityCheck', this, args);
        }
        const preSubject = resolveDurabilitySubject();
        const preWeaponId = preSubject ? equippedWeaponId(preSubject) : 0;
        const result = CabbyCodes.callOriginal(window, 'durabilityCheck', this, args);
        resetBrokenWeaponSafeHits(preWeaponId, preSubject);
        return result;
    });

    //----------------------------------------------------------------------
    // Submenu scene + window (mirrors locked-doors / set-difficulty pattern)
    //----------------------------------------------------------------------

    function pickerLayoutFor(scene, rowCount) {
        const width = Math.min(PICKER_WIDTH, Graphics.boxWidth - 32);
        const helpHeight = scene.calcWindowHeight(2, false);
        const listRows = Math.min(Math.max(rowCount, 1), PICKER_MAX_ROWS);
        const listHeight = scene.calcWindowHeight(listRows, true);
        const totalHeight = helpHeight + PICKER_SPACING + listHeight;
        const x = Math.max(0, Math.floor((Graphics.boxWidth - width) / 2));
        const baseY = Math.max(0, Math.floor((Graphics.boxHeight - totalHeight) / 2));
        return { x, baseY, width, helpHeight, listHeight };
    }

    function Scene_CabbyCodesVanillaBugFix() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesVanillaBugFix.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesVanillaBugFix.prototype.constructor = Scene_CabbyCodesVanillaBugFix;

    Scene_CabbyCodesVanillaBugFix.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createListWindow();
    };

    Scene_CabbyCodesVanillaBugFix.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesVanillaBugFix.prototype.createHelpWindow = function() {
        const layout = pickerLayoutFor(this, FIXES.length);
        const rect = new Rectangle(layout.x, layout.baseY, layout.width, layout.helpHeight);
        this._helpWindow = new Window_Help(rect);
        this._helpWindow.setText('Vanilla Bug Fix\nPress to toggle a fix.');
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesVanillaBugFix.prototype.createListWindow = function() {
        const layout = pickerLayoutFor(this, FIXES.length);
        const rect = new Rectangle(
            layout.x,
            layout.baseY + layout.helpHeight + PICKER_SPACING,
            layout.width,
            layout.listHeight
        );
        this._listWindow = new Window_CabbyCodesVanillaBugFixList(rect);
        this._listWindow.setHandler('ok', this.onFixOk.bind(this));
        this._listWindow.setHandler('cancel', this.onListCancel.bind(this));
        this.addWindow(this._listWindow);
        this._listWindow.select(0);
        this._listWindow.activate();
    };

    Scene_CabbyCodesVanillaBugFix.prototype.onFixOk = function() {
        const fix = this._listWindow.currentFix();
        if (!fix) {
            this._listWindow.activate();
            return;
        }
        const newValue = !isFixEnabled(fix.key);
        setFixEnabled(fix.key, newValue);
        CabbyCodes.log(`${LOG_PREFIX} ${fix.label}: ${newValue ? 'On' : 'Off'}`);
        this._listWindow.refresh();
        this._listWindow.activate();
    };

    Scene_CabbyCodesVanillaBugFix.prototype.onListCancel = function() {
        SceneManager.pop();
    };

    window.Scene_CabbyCodesVanillaBugFix = Scene_CabbyCodesVanillaBugFix;

    function Window_CabbyCodesVanillaBugFixList() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesVanillaBugFixList.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesVanillaBugFixList.prototype.constructor = Window_CabbyCodesVanillaBugFixList;

    Window_CabbyCodesVanillaBugFixList.prototype.numVisibleRows = function() {
        return Math.min(PICKER_MAX_ROWS, this.maxItems() || 1);
    };

    Window_CabbyCodesVanillaBugFixList.prototype.makeCommandList = function() {
        FIXES.forEach((fix, index) => {
            this.addCommand(fix.label, `vanillaBugFix_${fix.key}`, true, index);
        });
    };

    Window_CabbyCodesVanillaBugFixList.prototype.currentFix = function() {
        const index = this.currentExt();
        if (typeof index !== 'number') {
            return null;
        }
        return FIXES[index] || null;
    };

    Window_CabbyCodesVanillaBugFixList.prototype.drawItem = function(index) {
        const rect = this.itemLineRect(index);
        const fix = FIXES[index];
        if (!fix) {
            return;
        }
        const valueText = isFixEnabled(fix.key) ? 'On' : 'Off';
        const valueWidth = this.textWidth('Off');
        const labelWidth = Math.max(0, rect.width - valueWidth - 8);
        this.resetTextColor();
        this.changeTextColor(ColorManager.systemColor());
        this.drawText(fix.label, rect.x, rect.y, labelWidth, 'left');
        this.resetTextColor();
        this.drawText(valueText, rect.x + rect.width - valueWidth, rect.y, valueWidth, 'right');
    };

    window.Window_CabbyCodesVanillaBugFixList = Window_CabbyCodesVanillaBugFixList;

    CabbyCodes.log('[CabbyCodes] Vanilla Bug Fix module loaded');
})();
