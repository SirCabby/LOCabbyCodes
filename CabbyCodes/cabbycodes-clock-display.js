//=============================================================================
// CabbyCodes Clock Display
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Clock Display - Optional HUD with the current game time
 * @author CabbyCodes
 * @help
 * Adds a CabbyCodes setting that, when enabled, shows a compact clock panel in
 * the top-right corner of Scene_Map. The panel only appears while a game session
 * is active.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes][Clock] CabbyCodes core missing.');
        return;
    }

    const MODULE_TAG = '[CabbyCodes][Clock]';
    const SETTING_KEY = 'showClock';
    const DEFAULT_TIME_TEXT = '--:--';
    const CURRENT_DAY_VARIABLE_ID = 15;
    const CALENDAR_DAY_VARIABLE_ID = 14;
    const CLOCK_WINDOW_HEIGHT = 32;
    const CLOCK_MARGIN_X = 0;
    const CLOCK_MARGIN_Y = 0;
    const CLOCK_MIN_WIDTH = 128;
    const CLOCK_HORIZONTAL_PADDING = 12;
    const TIME_FONT_SIZE = 22;
    const REFRESH_INTERVAL_FRAMES = 12;
    const TIME_COLOR = '#ffffff';
    const BG_COLOR_TOP = 'rgba(6, 12, 24, 0.92)';
    const BG_COLOR_BOTTOM = 'rgba(6, 12, 24, 0.72)';

    const moduleApi = (CabbyCodes.clockDisplay = CabbyCodes.clockDisplay || {});
    moduleApi.settingKey = SETTING_KEY;

    CabbyCodes.registerSetting(SETTING_KEY, 'Show Clock', {
        defaultValue: false,
        order: 65,
        onChange: () => {
            refreshActiveSceneClock();
        }
    });

    moduleApi.shouldDisplayClock = function() {
        if (!CabbyCodes.getSetting(SETTING_KEY, false)) {
            return false;
        }
        if (typeof CabbyCodes.isGameSessionActive === 'function') {
            return CabbyCodes.isGameSessionActive();
        }
        return true;
    };

    moduleApi.readGameTime = function() {
        return readGameTimeString();
    };

    moduleApi.refreshActiveWindow = function() {
        refreshActiveSceneClock();
    };

    function refreshActiveSceneClock() {
        const scene = typeof SceneManager !== 'undefined' ? SceneManager._scene : null;
        if (scene && typeof scene.refreshCabbyCodesClock === 'function') {
            scene.refreshCabbyCodesClock();
        } else if (moduleApi._activeWindow) {
            moduleApi._activeWindow.setClockEnabled(moduleApi.shouldDisplayClock());
        }
    }

    function readGameTimeString() {
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return null;
        }
        const dayPrefix = readDayPrefix();
        const displayLabel = sanitizeTimeLabel($gameVariables.value(12));
        if (displayLabel) {
            return dayPrefix ? `${dayPrefix} ${displayLabel}` : displayLabel;
        }
        const hour = Number($gameVariables.value(16));
        const minute = Number($gameVariables.value(17));
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
            return null;
        }
        const time = formatNumericTime(hour, minute);
        return dayPrefix ? `${dayPrefix} ${time}` : time;
    }

    function readDayPrefix() {
        const primary = Number($gameVariables.value(CURRENT_DAY_VARIABLE_ID));
        if (Number.isFinite(primary) && primary > 0) {
            return `D${primary}`;
        }
        const fallback = Number($gameVariables.value(CALENDAR_DAY_VARIABLE_ID));
        if (Number.isFinite(fallback) && fallback > 0) {
            return `D${fallback}`;
        }
        if (Number.isFinite(primary)) {
            return `D${primary}`;
        }
        return null;
    }

    function sanitizeTimeLabel(value) {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed.length > 0) {
                return trimmed;
            }
        }
        return null;
    }

    function formatNumericTime(hour, minute) {
        const normalizedHour = ((Math.floor(hour) % 24) + 24) % 24;
        const normalizedMinute = ((Math.floor(minute) % 60) + 60) % 60;
        const hh = normalizedHour < 10 ? `0${normalizedHour}` : String(normalizedHour);
        const mm = normalizedMinute < 10 ? `0${normalizedMinute}` : String(normalizedMinute);
        return `${hh}:${mm}`;
    }

    function clockWindowRect() {
        const width = CLOCK_MIN_WIDTH;
        const height = CLOCK_WINDOW_HEIGHT;
        const x = Graphics.boxWidth - width - CLOCK_MARGIN_X;
        const y = CLOCK_MARGIN_Y;
        return new Rectangle(Math.max(CLOCK_MARGIN_X, x), y, width, height);
    }

    function Window_CabbyCodesClock() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesClock.prototype = Object.create(Window_Base.prototype);
    Window_CabbyCodesClock.prototype.constructor = Window_CabbyCodesClock;

    Window_CabbyCodesClock.prototype.initialize = function(rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this._refreshTimer = 0;
        this._lastTimeText = '';
        this.opacity = 0;
        this.backOpacity = 0;
        this.visible = false;
        this.refreshPanelBackground();
        this.requestImmediateRefresh();
    };

    // The default 12px window padding and 36px lineHeight leave only a 24px contents area
    // for a 22px font — Bitmap.drawText's baseline lands below that canvas and clips the
    // descender. Tighten padding and match lineHeight to the real contents area so
    // drawText's built-in baseline math vertically centers the glyph with only a couple
    // pixels of breathing room.
    Window_CabbyCodesClock.prototype.updatePadding = function() {
        this.padding = 4;
    };

    Window_CabbyCodesClock.prototype.lineHeight = function() {
        return this.contentsHeight();
    };

    Window_CabbyCodesClock.prototype.refreshPanelBackground = function() {
        if (!this.contentsBack) {
            return;
        }
        this.contentsBack.clear();
        this.contentsBack.gradientFillRect(
            0,
            0,
            this.contentsBack.width,
            this.contentsBack.height,
            BG_COLOR_TOP,
            BG_COLOR_BOTTOM,
            false
        );
    };

    Window_CabbyCodesClock.prototype.requestImmediateRefresh = function() {
        this._refreshTimer = 0;
    };

    Window_CabbyCodesClock.prototype.setClockEnabled = function(enabled) {
        if (enabled) {
            this.show();
            this.activate();
            this.requestImmediateRefresh();
            this.refreshClock(true);
        } else {
            this.hide();
            this.deactivate();
        }
    };

    Window_CabbyCodesClock.prototype.update = function() {
        Window_Base.prototype.update.call(this);
        if (!this.visible) {
            return;
        }
        if (this._refreshTimer > 0) {
            this._refreshTimer -= 1;
        }
        if (this._refreshTimer <= 0) {
            this._refreshTimer = REFRESH_INTERVAL_FRAMES;
            this.refreshClock();
        }
    };

    Window_CabbyCodesClock.prototype.refreshClock = function(force) {
        const timeText = moduleApi.readGameTime() || DEFAULT_TIME_TEXT;
        if (!force && timeText === this._lastTimeText) {
            return;
        }
        this._lastTimeText = timeText;
        this.adjustSizeForText(timeText);
        this.contents.clear();
        this.resetFontSettings();
        this.contents.fontSize = TIME_FONT_SIZE;
        this.changeTextColor(TIME_COLOR);
        this.drawText(timeText, 0, 0, this.contentsWidth(), 'center');
    };

    Window_CabbyCodesClock.prototype.adjustSizeForText = function(timeText) {
        this.resetFontSettings();
        this.contents.fontSize = TIME_FONT_SIZE;
        const textWidth = Math.ceil(this.textWidth(timeText));
        const desiredWidth = Math.max(
            CLOCK_MIN_WIDTH,
            textWidth + CLOCK_HORIZONTAL_PADDING * 2
        );
        const desiredX = Math.max(CLOCK_MARGIN_X, Graphics.boxWidth - desiredWidth - CLOCK_MARGIN_X);
        const desiredY = CLOCK_MARGIN_Y;
        if (this.width !== desiredWidth || this.height !== CLOCK_WINDOW_HEIGHT || this.x !== desiredX || this.y !== desiredY) {
            this.move(desiredX, desiredY, desiredWidth, CLOCK_WINDOW_HEIGHT);
            this.createContents();
            this.refreshPanelBackground();
        }
    };

    moduleApi.attachWindow = function(windowInstance) {
        moduleApi._activeWindow = windowInstance;
        windowInstance.setClockEnabled(moduleApi.shouldDisplayClock());
    };

    moduleApi.detachWindow = function(windowInstance) {
        if (moduleApi._activeWindow === windowInstance) {
            moduleApi._activeWindow = null;
        }
    };

    Scene_Map.prototype.createCabbyCodesClockWindow = function() {
        if (this._cabbyCodesClockWindow || !moduleApi.shouldDisplayClock()) {
            return;
        }
        const rect = clockWindowRect();
        const windowInstance = new Window_CabbyCodesClock(rect);
        this._cabbyCodesClockWindow = windowInstance;
        moduleApi.attachWindow(windowInstance);
        this.addWindow(windowInstance);
    };

    Scene_Map.prototype.refreshCabbyCodesClock = function() {
        if (moduleApi.shouldDisplayClock()) {
            if (!this._cabbyCodesClockWindow) {
                this.createCabbyCodesClockWindow();
            } else {
                this._cabbyCodesClockWindow.setClockEnabled(true);
            }
        } else if (this._cabbyCodesClockWindow) {
            this._cabbyCodesClockWindow.setClockEnabled(false);
        }
    };

    Scene_Map.prototype.destroyCabbyCodesClockWindow = function() {
        if (!this._cabbyCodesClockWindow) {
            return;
        }
        moduleApi.detachWindow(this._cabbyCodesClockWindow);
        if (this._cabbyCodesClockWindow.parent && typeof this._cabbyCodesClockWindow.parent.removeChild === 'function') {
            this._cabbyCodesClockWindow.parent.removeChild(this._cabbyCodesClockWindow);
        }
        if (typeof this._cabbyCodesClockWindow.destroy === 'function') {
            this._cabbyCodesClockWindow.destroy();
        }
        this._cabbyCodesClockWindow = null;
    };

    function hookSceneMap(methodName, handler) {
        if (!Scene_Map || !Scene_Map.prototype || typeof Scene_Map.prototype[methodName] !== 'function') {
            return;
        }
        if (typeof CabbyCodes.after === 'function') {
            CabbyCodes.after(Scene_Map.prototype, methodName, handler);
        } else {
            const original = Scene_Map.prototype[methodName];
            Scene_Map.prototype[methodName] = function(...args) {
                const result = original.apply(this, args);
                handler.apply(this, args);
                return result;
            };
        }
    }

    hookSceneMap('createDisplayObjects', function() {
        if (typeof this.createCabbyCodesClockWindow === 'function') {
            this.createCabbyCodesClockWindow();
        }
    });

    hookSceneMap('start', function() {
        if (typeof this.refreshCabbyCodesClock === 'function') {
            this.refreshCabbyCodesClock();
        }
    });

    hookSceneMap('terminate', function() {
        if (typeof this.destroyCabbyCodesClockWindow === 'function') {
            this.destroyCabbyCodesClockWindow();
        }
    });

    if (typeof CabbyCodes.log === 'function') {
        CabbyCodes.log(`${MODULE_TAG} Initialized`);
    } else {
        console.log(`${MODULE_TAG} Initialized`);
    }
})();


