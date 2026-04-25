//=============================================================================
// CabbyCodes Fast Credits Scroll
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Fast Credits Scroll - Contextual HUD toggle that speeds up the end credits.
 * @author CabbyCodes
 * @help
 * While the player is on the end-credits map (Map168), a small clickable
 * toggle appears in the top-right of the screen, just underneath the
 * CabbyCodes clock. Clicking it toggles a 20x scroll-speed multiplier on
 * the RPG Maker MZ scrolling-text command (event code 105) so the credits
 * blow past quickly. The toggle and the multiplier both auto-disable when
 * the game transfers to the post-credits "End Results" scoring map (Map274).
 *
 * The toggle is intentionally NOT registered with the Options menu — it
 * only appears when it's relevant, and resets each time it becomes
 * relevant.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Fast Credits Scroll requires CabbyCodes core.');
        return;
    }

    const MODULE_TAG = '[CabbyCodes][FastCredits]';
    const CREDITS_MAP_ID = 168;
    const POST_CREDITS_MAP_ID = 274;
    const SCROLL_MULTIPLIER = 20;

    const HUD_HEIGHT = 32;
    const HUD_MIN_WIDTH = 180;
    const HUD_MARGIN_X = 0;
    const HUD_Y_OFFSET = 32; // sits flush under the clock window (which is 32 tall at y=0)
    const HUD_HORIZONTAL_PADDING = 12;
    const HUD_FONT_SIZE = 20;
    const COLOR_OFF = '#ffffff';
    const COLOR_ON = '#7af5b3';
    const BG_COLOR_TOP = 'rgba(6, 12, 24, 0.92)';
    const BG_COLOR_BOTTOM = 'rgba(6, 12, 24, 0.72)';

    let fastEnabled = false;

    function currentMapId() {
        if (typeof $gameMap === 'undefined' || !$gameMap || typeof $gameMap.mapId !== 'function') {
            return 0;
        }
        return $gameMap.mapId();
    }

    function shouldShowHud() {
        if (typeof SceneManager === 'undefined' || !(SceneManager._scene instanceof Scene_Map)) {
            return false;
        }
        if (typeof CabbyCodes.isGameSessionActive === 'function' && !CabbyCodes.isGameSessionActive()) {
            return false;
        }
        return currentMapId() === CREDITS_MAP_ID;
    }

    //-------------------------------------------------------------------------
    // Scroll-speed override
    //-------------------------------------------------------------------------

    if (typeof Window_ScrollText === 'undefined') {
        CabbyCodes.warn(`${MODULE_TAG} Window_ScrollText is unavailable.`);
        return;
    }

    CabbyCodes.override(Window_ScrollText.prototype, 'scrollSpeed', function () {
        const baseSpeed = CabbyCodes.callOriginal(
            Window_ScrollText.prototype,
            'scrollSpeed',
            this,
            []
        );
        if (!fastEnabled || currentMapId() !== CREDITS_MAP_ID) {
            return baseSpeed;
        }
        return baseSpeed * SCROLL_MULTIPLIER;
    });

    //-------------------------------------------------------------------------
    // HUD window
    //-------------------------------------------------------------------------

    function Window_CabbyCodesFastCreditsToggle() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesFastCreditsToggle.prototype = Object.create(Window_Base.prototype);
    Window_CabbyCodesFastCreditsToggle.prototype.constructor = Window_CabbyCodesFastCreditsToggle;

    Window_CabbyCodesFastCreditsToggle.prototype.initialize = function (rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this.opacity = 0;
        this.backOpacity = 0;
        this._lastRenderedState = null;
        this.refreshPanelBackground();
        this.refreshLabel(true);
    };

    Window_CabbyCodesFastCreditsToggle.prototype.updatePadding = function () {
        this.padding = 4;
    };

    Window_CabbyCodesFastCreditsToggle.prototype.lineHeight = function () {
        return this.contentsHeight();
    };

    Window_CabbyCodesFastCreditsToggle.prototype.refreshPanelBackground = function () {
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

    Window_CabbyCodesFastCreditsToggle.prototype.currentLabel = function () {
        return fastEnabled ? 'Fast Credits: ON' : 'Fast Credits: OFF';
    };

    Window_CabbyCodesFastCreditsToggle.prototype.adjustSizeForText = function (label) {
        this.resetFontSettings();
        this.contents.fontSize = HUD_FONT_SIZE;
        const textWidth = Math.ceil(this.textWidth(label));
        const desiredWidth = Math.max(HUD_MIN_WIDTH, textWidth + HUD_HORIZONTAL_PADDING * 2);
        const desiredX = Math.max(
            HUD_MARGIN_X,
            Graphics.boxWidth - desiredWidth - HUD_MARGIN_X
        );
        const desiredY = HUD_Y_OFFSET;
        if (
            this.width !== desiredWidth ||
            this.height !== HUD_HEIGHT ||
            this.x !== desiredX ||
            this.y !== desiredY
        ) {
            this.move(desiredX, desiredY, desiredWidth, HUD_HEIGHT);
            this.createContents();
            this.refreshPanelBackground();
        }
    };

    Window_CabbyCodesFastCreditsToggle.prototype.refreshLabel = function (force) {
        const label = this.currentLabel();
        if (!force && label === this._lastRenderedState) {
            return;
        }
        this._lastRenderedState = label;
        this.adjustSizeForText(label);
        this.contents.clear();
        this.resetFontSettings();
        this.contents.fontSize = HUD_FONT_SIZE;
        this.changeTextColor(fastEnabled ? COLOR_ON : COLOR_OFF);
        this.drawText(label, 0, 0, this.contentsWidth(), 'center');
    };

    Window_CabbyCodesFastCreditsToggle.prototype.update = function () {
        Window_Base.prototype.update.call(this);
        if (!this.visible) {
            return;
        }
        this.refreshLabel(false);
        this.handleClickToggle();
    };

    Window_CabbyCodesFastCreditsToggle.prototype.handleClickToggle = function () {
        if (typeof TouchInput === 'undefined' || !TouchInput.isTriggered()) {
            return;
        }
        if (!this.containsTouchPoint(TouchInput.x, TouchInput.y)) {
            return;
        }
        fastEnabled = !fastEnabled;
        if (typeof SoundManager !== 'undefined' && typeof SoundManager.playCursor === 'function') {
            SoundManager.playCursor();
        }
        CabbyCodes.log(
            `${MODULE_TAG} Fast scroll ${fastEnabled ? 'enabled' : 'disabled'} via HUD toggle.`
        );
        this.refreshLabel(true);
    };

    Window_CabbyCodesFastCreditsToggle.prototype.containsTouchPoint = function (sx, sy) {
        return (
            sx >= this.x &&
            sx < this.x + this.width &&
            sy >= this.y &&
            sy < this.y + this.height
        );
    };

    //-------------------------------------------------------------------------
    // Scene_Map integration
    //-------------------------------------------------------------------------

    Scene_Map.prototype.createCabbyCodesFastCreditsHud = function () {
        if (this._cabbyCodesFastCreditsWindow) {
            return;
        }
        const rect = new Rectangle(
            Math.max(HUD_MARGIN_X, Graphics.boxWidth - HUD_MIN_WIDTH - HUD_MARGIN_X),
            HUD_Y_OFFSET,
            HUD_MIN_WIDTH,
            HUD_HEIGHT
        );
        this._cabbyCodesFastCreditsWindow = new Window_CabbyCodesFastCreditsToggle(rect);
        this.addWindow(this._cabbyCodesFastCreditsWindow);
    };

    Scene_Map.prototype.destroyCabbyCodesFastCreditsHud = function () {
        const hud = this._cabbyCodesFastCreditsWindow;
        if (!hud) {
            return;
        }
        if (hud.parent && typeof hud.parent.removeChild === 'function') {
            hud.parent.removeChild(hud);
        }
        if (typeof hud.destroy === 'function') {
            hud.destroy();
        }
        this._cabbyCodesFastCreditsWindow = null;
    };

    Scene_Map.prototype.refreshCabbyCodesFastCreditsHud = function () {
        if (shouldShowHud()) {
            if (!this._cabbyCodesFastCreditsWindow) {
                this.createCabbyCodesFastCreditsHud();
            }
            this._cabbyCodesFastCreditsWindow.show();
            this._cabbyCodesFastCreditsWindow.refreshLabel(true);
        } else {
            // Force-disable when the credits page is no longer the active map (e.g. transfer
            // to Map274 for the post-game scoring scroll). This ensures the End Results
            // scroll always plays at normal speed.
            fastEnabled = false;
            if (this._cabbyCodesFastCreditsWindow) {
                this.destroyCabbyCodesFastCreditsHud();
            }
        }
    };

    CabbyCodes.after(Scene_Map.prototype, 'start', function () {
        if (typeof this.refreshCabbyCodesFastCreditsHud === 'function') {
            this.refreshCabbyCodesFastCreditsHud();
        }
    });

    CabbyCodes.after(Scene_Map.prototype, 'terminate', function () {
        if (typeof this.destroyCabbyCodesFastCreditsHud === 'function') {
            this.destroyCabbyCodesFastCreditsHud();
        }
        // Reset the cheat between scene transitions so it never carries over.
        if (currentMapId() !== CREDITS_MAP_ID) {
            fastEnabled = false;
        }
    });

    CabbyCodes.log(`${MODULE_TAG} Fast credits scroll module loaded`);
})();
