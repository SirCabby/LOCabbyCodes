//=============================================================================
// CabbyCodes Version Display
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes UI - Shows the CabbyCodes version on the Cheats menu
 * @author CabbyCodes
 * @help
 * Displays the currently running CabbyCodes version at the bottom of the
 * Cheats menu so players can quickly confirm which build is installed.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        return;
    }

    if (typeof Scene_CabbyCodesCheats === 'undefined') {
        // Cheats scene must already be defined by cabbycodes-settings.js. If it
        // isn't, the loader order is wrong; bail rather than patching the wrong
        // scene.
        CabbyCodes.warn?.('[CabbyCodes] Version display: Scene_CabbyCodesCheats not defined; check loader order.');
        return;
    }

    const VERSION_UNKNOWN = '?.?.?';
    const OPTIONS_SIDE_PADDING = 24;
    const OPTIONS_TOP_PADDING = 24;
    const OPTIONS_BOTTOM_PADDING = 24;
    const VERSION_GAP = 12;
    const OPTIONS_MAX_WIDTH = 520;
    const VERSION_WINDOW_LINES = 1;
    const CABBYCODES_LABEL = 'CabbyCodes';
    const CABBYCODES_LABEL_COLOR = '#3f82ff';

    function cabbyCodesOptionCount() {
        if (!Array.isArray(CabbyCodes.settingsRegistry)) {
            return 0;
        }
        return CabbyCodes.settingsRegistry.length;
    }

    function desiredOptionsWidth() {
        const available = Math.max(0, Graphics.boxWidth - OPTIONS_SIDE_PADDING * 2);
        return Math.min(OPTIONS_MAX_WIDTH, available);
    }

    function versionWindowHeight(scene) {
        return scene.calcWindowHeight(VERSION_WINDOW_LINES, false);
    }

    function availableOptionsHeight(scene) {
        const totalAvailable = Math.max(
            0,
            Graphics.boxHeight - OPTIONS_TOP_PADDING - OPTIONS_BOTTOM_PADDING - versionWindowHeight(scene) - VERSION_GAP
        );
        const commandLines = Math.max(1, scene.maxCommands());
        const commandHeight = scene.calcWindowHeight(commandLines, true);
        const limitedHeight = Math.min(totalAvailable, commandHeight);
        if (limitedHeight > 0) {
            return limitedHeight;
        }
        return Math.min(commandHeight, scene.calcWindowHeight(6, true));
    }

    function applyOverride(methodName, implementation) {
        if (typeof CabbyCodes.override === 'function') {
            CabbyCodes.override(Scene_CabbyCodesCheats.prototype, methodName, implementation);
        } else {
            Scene_CabbyCodesCheats.prototype[methodName] = implementation;
        }
    }

    /**
     * Small informative window that renders the CabbyCodes version text.
     */
    function Window_CabbyCodesVersionInfo() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesVersionInfo = Window_CabbyCodesVersionInfo;

    Window_CabbyCodesVersionInfo.prototype = Object.create(Window_Base.prototype);
    Window_CabbyCodesVersionInfo.prototype.constructor = Window_CabbyCodesVersionInfo;

    Window_CabbyCodesVersionInfo.prototype.initialize = function(rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this.refresh();
    };

    Window_CabbyCodesVersionInfo.prototype.versionText = function() {
        const version = CabbyCodes.version || VERSION_UNKNOWN;
        return ` v${version}`;
    };

    Window_CabbyCodesVersionInfo.prototype.refresh = function() {
        this.contents.clear();
        this.resetFontSettings();
        const label = CABBYCODES_LABEL;
        const versionText = this.versionText();
        const labelWidth = this.textWidth(label + ' ');
        const versionWidth = this.textWidth(versionText);
        const totalWidth = labelWidth + versionWidth;
        const x = Math.max(0, Math.floor((this.contents.width - totalWidth) / 2));
        const y = Math.floor((this.contents.height - this.lineHeight()) / 2);
        this.changeTextColor(CABBYCODES_LABEL_COLOR);
        this.drawText(label, x, y, labelWidth, 'left');
        this.changeTextColor(ColorManager.normalColor());
        this.drawText(versionText, x + labelWidth, y, versionWidth, 'left');
    };

    /**
     * Size the Cheats command list to the actual cabby setting count and
     * give the window a consistent top-anchored layout that leaves room for
     * the version footer.
     */
    applyOverride('maxCommands', function() {
        return Math.max(1, cabbyCodesOptionCount());
    });

    applyOverride('maxVisibleCommands', function() {
        return Math.max(12, this.maxCommands());
    });

    applyOverride('optionsWindowRect', function() {
        const ww = desiredOptionsWidth();
        const wh = availableOptionsHeight(this);
        const wx = (Graphics.boxWidth - ww) / 2;
        const wy = OPTIONS_TOP_PADDING;
        return new Rectangle(wx, wy, ww, wh);
    });

    Scene_CabbyCodesCheats.prototype.createCabbyCodesVersionWindow = function() {
        if (this._cabbyCodesVersionWindow) {
            return;
        }
        const rect = this.cabbyCodesVersionWindowRect();
        this._cabbyCodesVersionWindow = new Window_CabbyCodesVersionInfo(rect);
        this.addWindow(this._cabbyCodesVersionWindow);
    };

    Scene_CabbyCodesCheats.prototype.cabbyCodesVersionWindowRect = function() {
        const ww = this._optionsWindow ? this._optionsWindow.width : desiredOptionsWidth();
        const wh = versionWindowHeight(this);
        const wx = this._optionsWindow ? this._optionsWindow.x : (Graphics.boxWidth - ww) / 2;
        const preferredWy = this._optionsWindow
            ? this._optionsWindow.y + this._optionsWindow.height + VERSION_GAP
            : Graphics.boxHeight - OPTIONS_BOTTOM_PADDING - wh;
        const maxWy = Graphics.boxHeight - OPTIONS_BOTTOM_PADDING - wh;
        const wy = Math.min(preferredWy, maxWy);
        return new Rectangle(wx, wy, ww, wh);
    };

    const attachVersionWindow = function() {
        if (typeof this.createCabbyCodesVersionWindow === 'function') {
            this.createCabbyCodesVersionWindow();
        }
    };

    if (typeof CabbyCodes.after === 'function') {
        CabbyCodes.after(Scene_CabbyCodesCheats.prototype, 'create', function() {
            attachVersionWindow.call(this);
        });
    } else {
        const _Scene_CabbyCodesCheats_create = Scene_CabbyCodesCheats.prototype.create;
        Scene_CabbyCodesCheats.prototype.create = function() {
            _Scene_CabbyCodesCheats_create.call(this);
            attachVersionWindow.call(this);
        };
    }

    CabbyCodes.log('[CabbyCodes] Version display initialized');
})();
