//=============================================================================
// CabbyCodes Enemy Health Bars
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Enemy Health Bars - Stylish HP plates above enemies
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that shows animated health plates above every
 * enemy (including bosses) during battle. The plates track HP changes in real
 * time, include a delayed "comet trail" to highlight recent damage, and stay
 * readable regardless of the current screen tone.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Enemy Health Bars requires the core module.');
        return;
    }

    const settingKey = 'displayEnemyHealthBars';
    const moduleApi = (CabbyCodes.enemyHealthBars = CabbyCodes.enemyHealthBars || {});

    /**
     * Returns whether the feature is currently enabled.
     * @returns {boolean}
     */
    moduleApi.isEnabled = function() {
        return CabbyCodes.getSetting(settingKey, true);
    };

    /**
     * Attempts to refresh the active battle spriteset so newly toggled settings
     * immediately apply without reloading the map/battle.
     */
    moduleApi.refreshActiveBattleSpriteset = function() {
        if (typeof SceneManager === 'undefined' || typeof Scene_Battle === 'undefined') {
            return;
        }
        const scene = SceneManager._scene;
        if (scene && scene instanceof Scene_Battle && scene._spriteset) {
            const manager = scene._spriteset._cabbycodesEnemyGaugeManager;
            if (manager) {
                manager.setEnabled(moduleApi.isEnabled());
                manager.forceRefresh();
            }
        }
    };

    CabbyCodes.registerSetting(settingKey, 'Enemy Health Bars', {
        defaultValue: true,
        order: 65,
        onChange: () => moduleApi.refreshActiveBattleSpriteset()
    });

    const COLOR_SETS = {
        normal: {
            fillStart: '#3df5ff',
            fillEnd: '#2ade8d',
            accent: '#9dfbff',
            border: 'rgba(93, 255, 215, 0.55)',
            trail: 'rgba(40, 80, 110, 0.8)',
            bossTagFill: 'rgba(56, 255, 230, 0.15)',
            bossTagStroke: 'rgba(130, 255, 240, 0.65)'
        },
        boss: {
            fillStart: '#ff7a18',
            fillEnd: '#ff0161',
            accent: '#ffd488',
            border: 'rgba(255, 155, 125, 0.7)',
            trail: 'rgba(90, 32, 48, 0.85)',
            bossTagFill: 'rgba(255, 105, 97, 0.18)',
            bossTagStroke: 'rgba(255, 155, 135, 0.9)'
        }
    };

    const PLATE_WIDTH = 180;
    const PLATE_HEIGHT = 60;
    const INNER_PADDING = 14;
    const NAME_TEXT_HEIGHT = 18;
    const GAUGE_TOP = 26;
    const GAUGE_HEIGHT = 10;
    const FOOTER_TOP = GAUGE_TOP + GAUGE_HEIGHT + 2;
    const VERTICAL_GAP_ABOVE_SPRITE = 12;
    const MAX_TICK_MARKS = 5;
    const SMOOTHING_PRIMARY = 0.18;
    const SMOOTHING_TRAIL = 0.08;
    const MIN_HEIGHT_FALLBACK = 48;
    const SCREEN_EDGE_PADDING = 12;

    /**
     * Returns value constrained between min/max.
     * @param {number} value
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    function clamp(value, min, max) {
        if (Number.isNaN(value)) {
            return min;
        }
        return Math.max(min, Math.min(max, value));
    }

    /**
     * Determines a battler's HP ratio even if hpRate() is unavailable.
     * @param {Game_Battler} battler
     * @returns {number}
     */
    function resolveHpRate(battler) {
        if (!battler) {
            return 0;
        }
        if (typeof battler.hpRate === 'function') {
            const candidate = battler.hpRate();
            return Number.isFinite(candidate) ? candidate : 0;
        }
        const maxHp = Math.max(1, battler.mhp || 0);
        const hpValue = Math.max(0, battler.hp || 0);
        if (maxHp <= 0) {
            return 0;
        }
        return hpValue / maxHp;
    }

    /**
     * Draws a rounded rectangle path on a canvas context.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @param {number} radius
     */
    function roundedRectPath(ctx, x, y, width, height, radius) {
        const r = Math.max(0, radius || 0);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    /**
     * Renders a rounded rectangle with optional stroke/shadow styling.
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} options
     */
    function renderRoundedRect(ctx, options) {
        const {
            x,
            y,
            width,
            height,
            radius,
            fillStyle,
            strokeStyle,
            strokeWidth = 1,
            shadowColor = null,
            shadowBlur = 0,
            shadowOffsetY = 0
        } = options;
        ctx.save();
        if (shadowColor) {
            ctx.shadowColor = shadowColor;
            ctx.shadowBlur = shadowBlur;
            ctx.shadowOffsetY = shadowOffsetY;
        } else {
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
        }
        roundedRectPath(ctx, x, y, width, height, radius);
        if (fillStyle) {
            ctx.fillStyle = fillStyle;
            ctx.fill();
        } else {
            ctx.clip();
        }
        if (strokeStyle && strokeWidth > 0) {
            ctx.lineWidth = strokeWidth;
            ctx.strokeStyle = strokeStyle;
            ctx.stroke();
        }
        ctx.restore();
    }

    class CabbyCodesEnemyGaugeManager {
        /**
         * @param {Spriteset_Battle} spriteset
         * @param {Sprite} layer
         */
        constructor(spriteset, layer) {
            this._spriteset = spriteset;
            this._layer = layer;
            this._plates = new Map();
            this._enabled = moduleApi.isEnabled();
        }

        /**
         * Enables or disables the feature globally.
         * @param {boolean} enabled
         */
        setEnabled(enabled) {
            this._enabled = Boolean(enabled);
        }

        /**
         * Forces every plate to redraw on the next update tick.
         */
        forceRefresh() {
            for (const plate of this._plates.values()) {
                plate.requestImmediateRedraw();
            }
        }

        /**
         * Updates the manager each frame.
         */
        update() {
            if (!this._layer || !Array.isArray(this._spriteset._enemySprites)) {
                return;
            }
            this._syncSprites();
            if (this._plates.size === 0) {
                return;
            }
            const plates = this._plates.values();
            if (!this._enabled) {
                for (const plate of plates) {
                    plate.setFeatureEnabled(false);
                    plate.updatePlate();
                }
                return;
            }
            for (const plate of plates) {
                plate.setFeatureEnabled(true);
                plate.updatePlate();
            }
        }

        /**
         * Cleans up all sprites and bitmaps.
         */
        destroy() {
            for (const plate of this._plates.values()) {
                plate.destroy({ children: true });
            }
            this._plates.clear();
            if (this._layer) {
                this._layer.removeChildren();
            }
        }

        /**
         * Ensures a plate exists for each enemy sprite and removes stale ones.
         * @private
         */
        _syncSprites() {
            const sprites = this._spriteset._enemySprites;
            const knownSet = new Set(sprites);

            for (const sprite of sprites) {
                if (!sprite || this._plates.has(sprite)) {
                    continue;
                }
                const plate = new CabbyCodesEnemyHealthPlate(sprite);
                this._plates.set(sprite, plate);
                this._layer.addChild(plate);
            }

            for (const [sprite, plate] of this._plates.entries()) {
                if (!knownSet.has(sprite) || !sprite.parent) {
                    plate.destroy({ children: true });
                    this._plates.delete(sprite);
                }
            }
        }
    }

    class CabbyCodesEnemyHealthPlate extends Sprite {
        /**
         * @param {Sprite_Enemy} sprite
         */
        constructor(sprite) {
            super();
            this._enemySprite = sprite;
            this._battler = sprite && sprite._battler ? sprite._battler : null;
            this._displayRate = this._battler ? clamp(resolveHpRate(this._battler), 0, 1) : 0;
            this._trailRate = this._displayRate;
            this._targetRate = this._displayRate;
            this._featureEnabled = true;
            this._isBoss = false;
            this._spriteHeight = MIN_HEIGHT_FALLBACK;
            this._localPoint = new PIXI.Point(0, 0);
            this._worldPoint = new PIXI.Point(0, 0);
            this._layerPoint = new PIXI.Point(0, 0);
            this._previousName = '';
            this._needsFullRedraw = true;
            this.opacity = 0;
            this.anchor.set(0.5, 1);
            this.z = 100;
            this.bitmap = new Bitmap(PLATE_WIDTH, PLATE_HEIGHT);
        }

        /**
         * Marks the plate as needing an immediate redraw (used after setting changes).
         */
        requestImmediateRedraw() {
            this._needsFullRedraw = true;
        }

        /**
         * Enables or disables the plate (with fade transitions).
         * @param {boolean} enabled
         */
        setFeatureEnabled(enabled) {
            this._featureEnabled = Boolean(enabled);
        }

        /**
         * Primary per-frame update called by the manager.
         */
        updatePlate() {
            this._refreshBattler();
            const targetVisible = this._shouldBeVisible();
            const fadeSpeed = targetVisible ? 30 : 25;
            const nextOpacity = targetVisible ? 255 : 0;
            if (this.opacity !== nextOpacity) {
                const delta = Math.sign(nextOpacity - this.opacity) * fadeSpeed;
                this.opacity = clamp(this.opacity + delta, 0, 255);
            }
            this.visible = this.opacity > 0;
            if (!this.visible || !this._battler) {
                return;
            }
            this._updateRates();
            this._updateStyleState();
            this._redrawPlate();
            this._updateScreenPosition();
        }

        /**
         * Cleans memory when destroyed.
         * @param {object} options
         */
        destroy(options) {
            if (this.bitmap) {
                this.bitmap.destroy();
                this.bitmap = null;
            }
            super.destroy(options);
        }

        /**
         * Ensures the battler reference stays current.
         * @private
         */
        _refreshBattler() {
            const nextBattler =
                this._enemySprite && this._enemySprite._battler
                    ? this._enemySprite._battler
                    : null;
            if (this._battler === nextBattler) {
                return;
            }
            this._battler = nextBattler;
            const rate = this._battler ? clamp(resolveHpRate(this._battler), 0, 1) : 0;
            this._targetRate = rate;
            this._displayRate = rate;
            this._trailRate = rate;
            this._needsFullRedraw = true;
        }

        /**
         * Determines if the plate should currently display.
         * @returns {boolean}
         */
        _shouldBeVisible() {
            if (!this._featureEnabled || !this._battler) {
                return false;
            }
            if (typeof this._battler.isHidden === 'function' && this._battler.isHidden()) {
                return false;
            }
            if (typeof this._battler.isAlive === 'function' && !this._battler.isAlive()) {
                return false;
            }
            if (!this._enemySprite || !this._enemySprite.visible) {
                return false;
            }
            return true;
        }

        /**
         * Smooths HP values for animation and afterimage.
         * @private
         */
        _updateRates() {
            const rawRate = this._battler ? clamp(resolveHpRate(this._battler), 0, 1) : 0;
            this._targetRate = rawRate;
            const diff = this._targetRate - this._displayRate;
            this._displayRate += diff * SMOOTHING_PRIMARY;

            if (this._trailRate > this._targetRate) {
                this._trailRate += (this._targetRate - this._trailRate) * SMOOTHING_TRAIL;
            } else {
                this._trailRate = this._displayRate;
            }
        }

        /**
         * Tracks whether the plate styling needs to change (boss vs normal, name changes, etc.).
         * @private
         */
        _updateStyleState() {
            const collapseType =
                this._battler && typeof this._battler.collapseType === 'function'
                    ? this._battler.collapseType()
                    : 0;
            const isBoss = collapseType === 1;
            if (this._isBoss !== isBoss) {
                this._isBoss = isBoss;
                this._needsFullRedraw = true;
            }
            let currentName = '';
            if (this._battler) {
                if (typeof this._battler.name === 'function') {
                    currentName = this._battler.name();
                } else if (this._battler._name) {
                    currentName = String(this._battler._name);
                }
            }
            if (this._previousName !== currentName) {
                this._previousName = currentName;
                this._needsFullRedraw = true;
            }
        }

        /**
         * Redraws the bitmap contents.
         * @private
         */
        _redrawPlate() {
            const bitmap = this.bitmap;
            if (!bitmap) {
                return;
            }
            bitmap.clear();
            const ctx = bitmap._context;
            const colorSet = this._isBoss ? COLOR_SETS.boss : COLOR_SETS.normal;
            const gradient = ctx.createLinearGradient(0, 0, 0, PLATE_HEIGHT);
            gradient.addColorStop(0, 'rgba(14, 18, 32, 0.96)');
            gradient.addColorStop(1, 'rgba(5, 8, 16, 0.92)');

            // Soft shadow
            bitmap.paintOpacity = 70;
            bitmap.fillRect(
                18,
                PLATE_HEIGHT - 6,
                PLATE_WIDTH - 36,
                6,
                'rgba(0, 0, 0, 0.65)'
            );
            bitmap.paintOpacity = 255;

            renderRoundedRect(ctx, {
                x: 0,
                y: 0,
                width: PLATE_WIDTH,
                height: PLATE_HEIGHT,
                radius: 0,
                fillStyle: gradient,
                strokeStyle: colorSet.border,
                strokeWidth: 1.2,
                shadowColor: 'rgba(0, 0, 0, 0.35)',
                shadowBlur: 8,
                shadowOffsetY: 2
            });

            // Gauge background
            renderRoundedRect(ctx, {
                x: INNER_PADDING,
                y: GAUGE_TOP,
                width: PLATE_WIDTH - INNER_PADDING * 2,
                height: GAUGE_HEIGHT,
                radius: 0,
                fillStyle: 'rgba(6, 10, 18, 0.9)',
                strokeStyle: 'rgba(255, 255, 255, 0.05)',
                strokeWidth: 1
            });

            const gaugeWidth = PLATE_WIDTH - INNER_PADDING * 2;
            const trailWidth = Math.max(Math.floor(gaugeWidth * this._trailRate), 0);
            if (trailWidth > 0) {
                renderRoundedRect(ctx, {
                    x: INNER_PADDING,
                    y: GAUGE_TOP,
                    width: trailWidth,
                    height: GAUGE_HEIGHT,
                    fillStyle: colorSet.trail
                });
            }

            const fillWidth = Math.max(Math.floor(gaugeWidth * this._displayRate), 1);
            if (fillWidth > 0) {
                const gaugeGradient = ctx.createLinearGradient(
                    INNER_PADDING,
                    GAUGE_TOP,
                    INNER_PADDING + fillWidth,
                    GAUGE_TOP
                );
                gaugeGradient.addColorStop(0, colorSet.fillStart);
                gaugeGradient.addColorStop(1, colorSet.fillEnd);
                renderRoundedRect(ctx, {
                    x: INNER_PADDING,
                    y: GAUGE_TOP,
                    width: fillWidth,
                    height: GAUGE_HEIGHT,
                    fillStyle: gaugeGradient
                });
            }

            // Tick marks
            ctx.save();
            ctx.globalAlpha = 0.25;
            for (let i = 1; i < MAX_TICK_MARKS; i += 1) {
                const tickX =
                    INNER_PADDING + Math.floor((gaugeWidth / MAX_TICK_MARKS) * i);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.fillRect(tickX, GAUGE_TOP + 1, 1, GAUGE_HEIGHT - 2);
            }
            ctx.restore();

            // Text: name and percent
            const fontFace =
                typeof $gameSystem !== 'undefined' &&
                $gameSystem &&
                typeof $gameSystem.mainFontFace === 'function'
                    ? $gameSystem.mainFontFace()
                    : 'sans-serif';
            bitmap.fontFace = fontFace;
            bitmap.fontSize = 18;
            bitmap.textColor = '#f5f8ff';
            bitmap.outlineColor = 'rgba(0, 0, 0, 0.65)';
            bitmap.outlineWidth = 3;
            const nameWidth = PLATE_WIDTH - INNER_PADDING * 2 - 60;
            bitmap.drawText(
                this._previousName,
                INNER_PADDING,
                4,
                nameWidth,
                NAME_TEXT_HEIGHT,
                'left'
            );

            bitmap.fontSize = 16;
            bitmap.textColor = colorSet.accent;
            const percentText = `${Math.round(this._targetRate * 100)}%`;
            bitmap.drawText(
                percentText,
                PLATE_WIDTH - INNER_PADDING - 60,
                4,
                60,
                NAME_TEXT_HEIGHT,
                'right'
            );

            // Boss tag
            if (this._isBoss) {
                const tagWidth = 48;
                const tagHeight = 16;
                const tagX = PLATE_WIDTH - INNER_PADDING - tagWidth;
                const tagY = NAME_TEXT_HEIGHT + 6;
                renderRoundedRect(ctx, {
                    x: tagX,
                    y: tagY,
                    width: tagWidth,
                    height: tagHeight,
                    radius: 6,
                    fillStyle: colorSet.bossTagFill,
                    strokeStyle: colorSet.bossTagStroke,
                    strokeWidth: 1
                });
                bitmap.fontSize = 12;
                bitmap.textColor = '#ffe6d0';
                bitmap.drawText('BOSS', tagX, tagY - 2, tagWidth, tagHeight + 4, 'center');
            }

            // HP text footer
            const currentHp = Math.max(0, Math.floor(this._battler.hp || 0));
            const maxHp = Math.max(1, Math.floor(this._battler.mhp || 1));
            const hpText = `${currentHp.toLocaleString()}/${maxHp.toLocaleString()}`;
            bitmap.fontSize = 15;
            bitmap.textColor = '#d4e9ff';
            bitmap.drawText(
                hpText,
                INNER_PADDING,
                FOOTER_TOP,
                PLATE_WIDTH - INNER_PADDING * 2,
                18,
                'left'
            );

            this._markBitmapDirty(bitmap);
            this._needsFullRedraw = false;
        }

        /**
         * Ensures PIXI sees the bitmap as dirty regardless of engine version.
         * @param {Bitmap} bitmap
         * @private
         */
        _markBitmapDirty(bitmap) {
            if (!bitmap) {
                return;
            }
            if (typeof bitmap._setDirty === 'function') {
                bitmap._setDirty();
            } else if (typeof bitmap.setDirty === 'function') {
                bitmap.setDirty();
            } else if (
                bitmap.baseTexture &&
                typeof bitmap.baseTexture.update === 'function'
            ) {
                bitmap.baseTexture.update();
            }
        }

        /**
         * Positions the plate above the referenced enemy sprite, accounting for camera shake/zoom.
         * @private
         */
        _updateScreenPosition() {
            if (!this.parent || !this._enemySprite) {
                return;
            }
            const spriteHeight = this._measureSpriteHeight();
            this._localPoint.set(0, -(spriteHeight + VERTICAL_GAP_ABOVE_SPRITE));
            this._enemySprite.toGlobal(this._localPoint, this._worldPoint);
            this.parent.toLocal(this._worldPoint, null, this._layerPoint);
            const bounds = this._getScreenBounds();
            const halfWidth = PLATE_WIDTH / 2;
            const minX = SCREEN_EDGE_PADDING + halfWidth;
            const maxX = bounds.width - SCREEN_EDGE_PADDING - halfWidth;
            const minY = SCREEN_EDGE_PADDING + PLATE_HEIGHT;
            const maxY = bounds.height - SCREEN_EDGE_PADDING;
            const clampedX = clamp(this._layerPoint.x, minX, maxX);
            const clampedY = clamp(this._layerPoint.y, minY, maxY);
            this.position.set(clampedX, clampedY);
        }

        /**
         * Estimates the sprite height even before bitmaps finish loading.
         * @private
         * @returns {number}
         */
        _measureSpriteHeight() {
            const sprite = this._enemySprite;
            if (!sprite) {
                return this._spriteHeight;
            }
            const measuredHeight =
                sprite.height || (sprite._frame ? sprite._frame.height : 0) || 0;
            if (measuredHeight > 0) {
                this._spriteHeight = measuredHeight;
            } else if (sprite.bitmap && sprite.bitmap.height) {
                this._spriteHeight = sprite.bitmap.height * Math.abs(sprite.scale.y || 1);
            }
            return Math.max(this._spriteHeight, MIN_HEIGHT_FALLBACK);
        }

        /**
         * Retrieves the current screen bounds, falling back to defaults if needed.
         * @private
         * @returns {{width:number,height:number}}
         */
        _getScreenBounds() {
            const width =
                (typeof Graphics !== 'undefined' && (Graphics.width || Graphics.boxWidth)) || 816;
            const height =
                (typeof Graphics !== 'undefined' && (Graphics.height || Graphics.boxHeight)) || 624;
            return { width, height };
        }
    }

    // -- Hooks ----------------------------------------------------------------

    CabbyCodes.after(Spriteset_Battle.prototype, 'createLowerLayer', function() {
        if (this._cabbycodesGaugeLayer) {
            this._cabbycodesGaugeLayer.removeChildren();
        } else {
            this._cabbycodesGaugeLayer = new Sprite();
            this._cabbycodesGaugeLayer.name = 'CabbyCodesEnemyGaugeLayer';
            this._cabbycodesGaugeLayer.setFrame(0, 0, Graphics.width, Graphics.height);
            this.addChild(this._cabbycodesGaugeLayer);
        }
    });

    CabbyCodes.after(Spriteset_Battle.prototype, 'update', function() {
        if (!this._cabbycodesGaugeLayer) {
            return;
        }
        if (!this._cabbycodesEnemyGaugeManager) {
            this._cabbycodesEnemyGaugeManager = new CabbyCodesEnemyGaugeManager(
                this,
                this._cabbycodesGaugeLayer
            );
        }
        this._cabbycodesEnemyGaugeManager.setEnabled(moduleApi.isEnabled());
        this._cabbycodesEnemyGaugeManager.update();
    });

    if (typeof Scene_Battle !== 'undefined') {
        CabbyCodes.after(Scene_Battle.prototype, 'terminate', function() {
            const spriteset = this._spriteset;
            if (spriteset && spriteset._cabbycodesEnemyGaugeManager) {
                spriteset._cabbycodesEnemyGaugeManager.destroy();
                spriteset._cabbycodesEnemyGaugeManager = null;
            }
            if (spriteset && spriteset._cabbycodesGaugeLayer) {
                spriteset._cabbycodesGaugeLayer.removeChildren();
            }
        });
    }

    CabbyCodes.log('[CabbyCodes] Enemy health bars module loaded');
})();


