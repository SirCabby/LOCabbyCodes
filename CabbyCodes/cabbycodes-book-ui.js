//=============================================================================
// CabbyCodes Book UI Helpers
//=============================================================================
/*:
 * @target MZ
 * @plugindesc Shared UI helpers for CabbyCodes recipe/cookbook style windows
 * @author CabbyCodes
 * @help
 * Provides shared drawing utilities and header window implementation for
 * CabbyCodes book-style interfaces (recipe book, cook book, etc).
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Book UI helpers require the core module.');
        return;
    }

    const bookUi = (CabbyCodes.bookUi = CabbyCodes.bookUi || {});

    const defaults = {
        windowWidth: 640,
        rowHeight: 24,
        rowSpacing: 2,
        contentPadding: 12,
        rowContentLeft: 16,
        rowContentRight: 8,
        checkboxSize: 15,
        checkboxCornerRadius: 2,
        checkboxOuterBorderColor: '#050b10',
        checkboxOuterBorderWidth: 1.5,
        checkboxInnerBorderColor: 'rgba(255, 255, 255, 0.45)',
        checkboxInnerBorderWidth: 1,
        checkboxCheckedFillTop: '#c9fff3',
        checkboxCheckedFillBottom: '#1f8d77',
        checkboxUncheckedFillTop: '#4a5a68',
        checkboxUncheckedFillBottom: '#212a34',
        checkboxHighlightTop: 'rgba(255, 255, 255, 0.85)',
        checkboxHighlightBottom: 'rgba(255, 255, 255, 0.05)',
        checkboxHighlightHeightRatio: 0.45,
        checkboxInnerShadowColor: 'rgba(0, 0, 0, 0.45)',
        checkboxInnerShadowBlur: 5,
        checkboxInnerShadowOffsetY: 1,
        checkboxCheckColor: '#0b181c',
        checkboxCheckShadowColor: 'rgba(0, 0, 0, 0.85)',
        checkboxCheckGlow: 'rgba(0, 0, 0, 0.2)',
        checkboxCheckLineWidth: 2.8,
        checkboxPadding: 3,
        backgroundTopColor: 'rgba(12, 20, 32, 0.98)',
        backgroundBottomColor: 'rgba(8, 16, 28, 0.95)'
    };

    bookUi.defaults = Object.assign({}, defaults);

    function resolveBitmap(target) {
        if (!target) {
            return null;
        }
        if (typeof target.fillRect === 'function') {
            return target;
        }
        if (target.contents && typeof target.contents.fillRect === 'function') {
            return target.contents;
        }
        return null;
    }

    function getBitmapAndContext(target) {
        const bitmap = resolveBitmap(target);
        if (!bitmap) {
            return null;
        }
        const context = bitmap.context || bitmap._context || null;
        return { bitmap, context };
    }

    function requestBitmapUpdate(bitmap) {
        if (!bitmap) {
            return;
        }
        if (bitmap._baseTexture && typeof bitmap._baseTexture.update === 'function') {
            bitmap._baseTexture.update();
        } else if (typeof bitmap.touch === 'function') {
            bitmap.touch();
        }
    }

    function roundedRectPath(ctx, x, y, width, height, radius) {
        const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
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

    bookUi.applyPanelBackground = function(windowInstance, overrides = {}) {
        const target = windowInstance?.contentsBack;
        if (!target) {
            return;
        }
        const gradientTop = overrides.gradientTop || defaults.backgroundTopColor;
        const gradientBottom = overrides.gradientBottom || defaults.backgroundBottomColor;
        target.clear();
        target.gradientFillRect(
            0,
            0,
            target.width,
            target.height,
            gradientTop,
            gradientBottom,
            true
        );
    };

    bookUi.drawCheckbox = function(target, x, y, checked, options = {}) {
        const contextInfo = getBitmapAndContext(target);
        if (!contextInfo) {
            return;
        }
        const { bitmap, context: ctx } = contextInfo;
        const size = options.size ?? defaults.checkboxSize;
        const radius = options.radius ?? defaults.checkboxCornerRadius;
        const outerColor = options.outerBorderColor || defaults.checkboxOuterBorderColor;
        const outerWidth = options.outerBorderWidth ?? defaults.checkboxOuterBorderWidth;
        const innerBorderColor = options.innerBorderColor || defaults.checkboxInnerBorderColor;
        const innerBorderWidth = options.innerBorderWidth ?? defaults.checkboxInnerBorderWidth;
        const checkedFillTop = options.checkedFillTop || defaults.checkboxCheckedFillTop;
        const checkedFillBottom = options.checkedFillBottom || defaults.checkboxCheckedFillBottom;
        const uncheckedFillTop = options.uncheckedFillTop || defaults.checkboxUncheckedFillTop;
        const uncheckedFillBottom =
            options.uncheckedFillBottom || defaults.checkboxUncheckedFillBottom;
        const highlightTop = options.highlightTop || defaults.checkboxHighlightTop;
        const highlightBottom = options.highlightBottom || defaults.checkboxHighlightBottom;
        const highlightRatio =
            options.highlightHeightRatio ?? defaults.checkboxHighlightHeightRatio;
        const innerShadowColor = options.innerShadowColor || defaults.checkboxInnerShadowColor;
        const innerShadowBlur = options.innerShadowBlur ?? defaults.checkboxInnerShadowBlur;
        const innerShadowOffsetY =
            options.innerShadowOffsetY ?? defaults.checkboxInnerShadowOffsetY;
        const checkColor = options.checkColor || defaults.checkboxCheckColor;
        const checkLineWidth = options.checkLineWidth ?? defaults.checkboxCheckLineWidth;
        const checkGlow = options.checkGlow ?? defaults.checkboxCheckGlow;
        const checkPadding = options.padding ?? defaults.checkboxPadding;
        const inset = options.inset ?? Math.max(outerWidth, 1);
        const fillTop = checked ? checkedFillTop : uncheckedFillTop;
        const fillBottom = checked ? checkedFillBottom : uncheckedFillBottom;

        if (!ctx) {
            bitmap.fillRect(x, y, size, size, outerColor);
            const innerSize = Math.max(0, size - inset * 2);
            const innerX = x + inset;
            const innerY = y + inset;
            bitmap.gradientFillRect(innerX, innerY, innerSize, innerSize, fillTop, fillBottom, true);
            const borderWidth = Math.max(1, Math.round(innerBorderWidth));
            bitmap.fillRect(innerX, innerY, innerSize, borderWidth, innerBorderColor);
            bitmap.fillRect(innerX, innerY, borderWidth, innerSize, innerBorderColor);
            bitmap.fillRect(innerX + innerSize - borderWidth, innerY, borderWidth, innerSize, innerBorderColor);
            bitmap.fillRect(innerX, innerY + innerSize - borderWidth, innerSize, borderWidth, innerBorderColor);
            const highlightHeight = Math.max(1, Math.floor(innerSize * highlightRatio));
            bitmap.gradientFillRect(
                innerX + 1,
                innerY + 1,
                Math.max(0, innerSize - 2),
                highlightHeight,
                highlightTop,
                highlightBottom,
                true
            );
            if (checked) {
                bookUi.drawCheckmark(bitmap, x, y, size, {
                    color: checkColor,
                    lineWidth: checkLineWidth,
                    padding: checkPadding,
                    glowColor: checkGlow
                });
            }
            requestBitmapUpdate(bitmap);
            return;
        }

        ctx.save();
        roundedRectPath(ctx, x, y, size, size, radius);
        ctx.fillStyle = outerColor;
        ctx.fill();
        ctx.restore();

        const innerSize = Math.max(0, size - inset * 2);
        const innerX = x + inset;
        const innerY = y + inset;
        const innerRadius = Math.max(0, radius - 1);

        ctx.save();
        roundedRectPath(ctx, innerX, innerY, innerSize, innerSize, innerRadius);
        const fillGradient = ctx.createLinearGradient(innerX, innerY, innerX, innerY + innerSize);
        fillGradient.addColorStop(0, fillTop);
        fillGradient.addColorStop(1, fillBottom);
        ctx.fillStyle = fillGradient;
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.lineWidth = innerBorderWidth;
        ctx.strokeStyle = innerBorderColor;
        roundedRectPath(ctx, innerX, innerY, innerSize, innerSize, innerRadius);
        ctx.stroke();
        ctx.restore();

        const highlightHeight = Math.max(1, innerSize * highlightRatio);
        ctx.save();
        roundedRectPath(
            ctx,
            innerX + 0.5,
            innerY + 0.5,
            innerSize - 1,
            highlightHeight,
            Math.max(0, innerRadius - 0.5)
        );
        const highlightGradient = ctx.createLinearGradient(
            innerX,
            innerY,
            innerX,
            innerY + highlightHeight
        );
        highlightGradient.addColorStop(0, highlightTop);
        highlightGradient.addColorStop(1, highlightBottom);
        ctx.fillStyle = highlightGradient;
        ctx.fill();
        ctx.restore();

        if (innerShadowColor && innerShadowBlur > 0) {
            ctx.save();
            const shadowGradient = ctx.createLinearGradient(
                innerX,
                innerY + innerSize * 0.35,
                innerX,
                innerY + innerSize
            );
            shadowGradient.addColorStop(0, 'rgba(0,0,0,0)');
            shadowGradient.addColorStop(1, innerShadowColor);
            ctx.fillStyle = shadowGradient;
            roundedRectPath(
                ctx,
                innerX + 0.5,
                innerY + 0.5,
                innerSize - 1,
                innerSize - 1,
                Math.max(0, innerRadius - 0.5)
            );
            ctx.shadowColor = innerShadowColor;
            ctx.shadowBlur = innerShadowBlur;
            ctx.shadowOffsetY = innerShadowOffsetY;
            ctx.fill();
            ctx.restore();
        }

        if (checked) {
            bookUi.drawCheckmark(bitmap, x, y, size, {
                color: checkColor,
                lineWidth: checkLineWidth,
                padding: checkPadding,
                glowColor: checkGlow
            });
        }

        requestBitmapUpdate(bitmap);
    };

    bookUi.drawCheckmark = function(target, x, y, size, options = {}) {
        const contextInfo = getBitmapAndContext(target);
        if (!contextInfo) {
            return;
        }
        const { bitmap, context: ctx } = contextInfo;
        const checkColor = options.color || defaults.checkboxCheckColor;
        const lineWidth = options.lineWidth ?? defaults.checkboxCheckLineWidth;
        const padding = options.padding ?? defaults.checkboxPadding;
        const glowColor = options.glowColor || defaults.checkboxCheckGlow;
        const glowBlur = options.glowBlur ?? 2;
        const shadowColor = options.shadowColor || defaults.checkboxCheckShadowColor;
        const shadowOffset = options.shadowOffset ?? 0.6;

        const startX = x + size * 0.22;
        const startY = y + size * 0.62;
        const midX = x + size * 0.38;
        const midY = y + size * 0.79;
        const endX = x + size * 0.78;
        const endY = y + size * 0.25;

        if (ctx) {
            ctx.save();
            ctx.lineWidth = lineWidth + 1.2;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.strokeStyle = shadowColor;
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            ctx.moveTo(startX + shadowOffset, startY + shadowOffset);
            ctx.lineTo(midX + shadowOffset, midY + shadowOffset);
            ctx.lineTo(endX + shadowOffset, endY + shadowOffset);
            ctx.stroke();
            ctx.restore();

            ctx.save();
            ctx.lineWidth = lineWidth;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.strokeStyle = checkColor;
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = glowBlur;
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(midX, midY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
            ctx.restore();
        } else {
            bookUi.drawThickLine(
                bitmap,
                startX + shadowOffset,
                startY + shadowOffset,
                midX + shadowOffset,
                midY + shadowOffset,
                lineWidth + 1.2,
                shadowColor
            );
            bookUi.drawThickLine(
                bitmap,
                midX + shadowOffset,
                midY + shadowOffset,
                endX + shadowOffset,
                endY + shadowOffset,
                lineWidth + 1.2,
                shadowColor
            );
            bookUi.drawThickLine(bitmap, startX, startY, midX, midY, lineWidth, checkColor);
            bookUi.drawThickLine(bitmap, midX, midY, endX, endY, lineWidth, checkColor);
        }

        requestBitmapUpdate(bitmap);
    };

    bookUi.drawThickLine = function(target, x1, y1, x2, y2, thickness, color) {
        const contextInfo = getBitmapAndContext(target);
        if (!contextInfo) {
            return;
        }
        const { bitmap, context: ctx } = contextInfo;
        if (ctx) {
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = thickness;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.restore();
            requestBitmapUpdate(bitmap);
            return;
        }

        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length === 0) {
            return;
        }

        const step = 1 / Math.max(Math.abs(dx), Math.abs(dy));
        const halfThick = Math.ceil(thickness / 2);

        for (let t = 0; t <= 1; t += step) {
            const px = Math.round(x1 + dx * t);
            const py = Math.round(y1 + dy * t);
            bitmap.fillRect(px - halfThick, py - halfThick, thickness, thickness, color);
        }
    };

    function defaultCountFormatter(info) {
        const discovered = info?.discovered ?? 0;
        const total = info?.total ?? 0;
        return `${discovered} / ${total}`;
    }

    function canUseWindowBase() {
        return typeof Window_Base !== 'undefined';
    }

    let Window_CabbyCodesBookHeader = null;

    if (canUseWindowBase()) {
        Window_CabbyCodesBookHeader = function(rect, options = {}) {
            this._bookUiOptions = Object.assign(
                {
                    title: '',
                    contentPadding: defaults.contentPadding,
                    gradientTop: defaults.backgroundTopColor,
                    gradientBottom: defaults.backgroundBottomColor,
                    formatCount: defaultCountFormatter
                },
                options || {}
            );
            Window_Base.prototype.initialize.call(this, rect);
            this.opacity = 255;
            this._listWindow = null;
            this.padding = this.standardPadding();
            this.refreshBackground();
            this.refresh();
        };

        Window_CabbyCodesBookHeader.prototype = Object.create(Window_Base.prototype);
        Window_CabbyCodesBookHeader.prototype.constructor = Window_CabbyCodesBookHeader;

        Window_CabbyCodesBookHeader.prototype.setTitle = function(title) {
            if (title === this._bookUiOptions.title) {
                return;
            }
            this._bookUiOptions.title = title || '';
            this.refresh();
        };

        Window_CabbyCodesBookHeader.prototype.setListWindow = function(listWindow) {
            this._listWindow = listWindow || null;
            this.refresh();
        };

        Window_CabbyCodesBookHeader.prototype.headerInfo = function() {
            if (this._listWindow && typeof this._listWindow.headerInfo === 'function') {
                return this._listWindow.headerInfo();
            }
            return { discovered: 0, total: 0 };
        };

        Window_CabbyCodesBookHeader.prototype.refreshBackground = function() {
            bookUi.applyPanelBackground(this, {
                gradientTop: this._bookUiOptions.gradientTop,
                gradientBottom: this._bookUiOptions.gradientBottom
            });
        };

        Window_CabbyCodesBookHeader.prototype.refresh = function() {
            if (!this.contents) {
                this.createContents();
            }
            this.resetFontSettings();
            this.contents.clear();
            this.refreshBackground();

            const info = this.headerInfo();
            const padding = this._bookUiOptions.contentPadding ?? defaults.contentPadding;
            const usableWidth = this.contentsWidth() - padding * 2;
            const halfWidth = Math.floor(usableWidth / 2);
            const lineY = Math.max(
                0,
                Math.floor((this.contentsHeight() - this.lineHeight()) / 2)
            );

            const titleText = this._bookUiOptions.title || '';
            this.changeTextColor(ColorManager?.systemColor?.() || '#FFFFFF');
            this.drawText(titleText, padding, lineY, halfWidth, 'left');

            const formatter =
                typeof this._bookUiOptions.formatCount === 'function'
                    ? this._bookUiOptions.formatCount
                    : defaultCountFormatter;
            const countText = formatter(info);
            this.changeTextColor(ColorManager?.normalColor?.() || '#FFFFFF');
            this.drawText(countText, padding + halfWidth, lineY, usableWidth - halfWidth, 'right');
        };

        Window_CabbyCodesBookHeader.prototype.standardPadding = function() {
            return 8;
        };

        Window_CabbyCodesBookHeader.prototype.updatePadding = function() {
            this.padding = this.standardPadding();
        };

        bookUi.BookHeaderWindow = Window_CabbyCodesBookHeader;
        window.Window_CabbyCodesBookHeader = Window_CabbyCodesBookHeader;
    }

    const logger = typeof CabbyCodes.log === 'function' ? CabbyCodes.log : console.log;
    logger('[CabbyCodes] Book UI helpers initialized');
})();


