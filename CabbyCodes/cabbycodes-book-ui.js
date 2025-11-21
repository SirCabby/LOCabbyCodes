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
        checkboxSize: 16,
        checkboxCheckedColor: '#68ffd1',
        checkboxUncheckedColor: 'rgba(255, 255, 255, 0.3)',
        checkboxBorderColor: '#ffffff',
        checkboxCheckColor: '#000000',
        checkboxLineWidth: 2.5,
        checkboxPadding: 4,
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
        const bitmap = resolveBitmap(target);
        if (!bitmap) {
            return;
        }
        const size = options.size ?? defaults.checkboxSize;
        const borderWidth = options.borderWidth ?? 2;
        const checkedColor = options.checkedColor || defaults.checkboxCheckedColor;
        const uncheckedColor = options.uncheckedColor || defaults.checkboxUncheckedColor;
        const borderColor = options.borderColor || defaults.checkboxBorderColor;
        const padding = options.padding ?? defaults.checkboxPadding;
        const checkColor = options.checkColor || defaults.checkboxCheckColor;
        const lineWidth = options.lineWidth ?? defaults.checkboxLineWidth;

        bitmap.fillRect(x, y, size, size, checked ? checkedColor : uncheckedColor);
        bitmap.fillRect(x, y, size, borderWidth, borderColor);
        bitmap.fillRect(x, y, borderWidth, size, borderColor);
        bitmap.fillRect(x + size - borderWidth, y, borderWidth, size, borderColor);
        bitmap.fillRect(x, y + size - borderWidth, size, borderWidth, borderColor);

        if (checked) {
            bookUi.drawCheckmark(bitmap, x, y, size, { color: checkColor, lineWidth, padding });
        }
    };

    bookUi.drawCheckmark = function(target, x, y, size, options = {}) {
        const bitmap = resolveBitmap(target);
        if (!bitmap) {
            return;
        }
        const checkColor = options.color || defaults.checkboxCheckColor;
        const lineWidth = options.lineWidth ?? defaults.checkboxLineWidth;
        const padding = options.padding ?? defaults.checkboxPadding;

        const startX = x + padding;
        const startY = y + size - padding;
        const midX = x + size / 2;
        const midY = y + size / 2 + 1;
        const endX = x + size - padding;
        const endY = y + padding;

        bookUi.drawThickLine(bitmap, startX, startY, midX, midY, lineWidth, checkColor);
        bookUi.drawThickLine(bitmap, midX, midY, endX, endY, lineWidth, checkColor);
    };

    bookUi.drawThickLine = function(target, x1, y1, x2, y2, thickness, color) {
        const bitmap = resolveBitmap(target);
        if (!bitmap) {
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


