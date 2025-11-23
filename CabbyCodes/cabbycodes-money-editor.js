//=============================================================================
// CabbyCodes Money Editor
//=============================================================================
/*:
 * @target MZ
 * @plugindesc Adds an inline money edit button to Scene_Menu's gold display.
 * @author CabbyCodes
 * @help
 * Draws a pencil-styled edit button next to the gold total shown in the main
 * menu. Clicking the button opens a numeric editor that works like the item
 * editor (type digits, use arrow keys, press Accept/Cancel) but without the
 * delete option. Useful for adjusting the party bankroll on the fly.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Money editor requires the core module.');
        return;
    }

    if (typeof window.Window_CabbyCodesItemEdit === 'undefined') {
        console.warn('[CabbyCodes] Money editor requires the item editor module.');
        return;
    }

    const BUTTON_TARGET_SIZE = 40;
    const BUTTON_MIN_SIZE = 30;
    const BUTTON_MAX_SIZE = 46;
    const BUTTON_GAP = 10;
    const BUTTON_COLOR = '#1f2b38';
    const BUTTON_BORDER = '#0b1118';
    const BUTTON_HIGHLIGHT = '#3ec793';
    const BUTTON_HOVER_ALPHA = 0.9;
    const QUANTITY_HINT_EXTRA_HEIGHT = 18;
    const QUANTITY_HINT_MARGIN = 4;
    const EDIT_MODAL_EXTRA_HEIGHT = QUANTITY_HINT_EXTRA_HEIGHT + 4;
    const EDIT_MODAL_BUTTON_MIN_WIDTH = 120;

    const MoneyEditor = {
        state: null,

        attachScene(scene) {
            if (!scene) {
                return;
            }
            if (!scene._cabbycodesMoneyEditor) {
                scene._cabbycodesMoneyEditor = {};
            }
            scene._cabbycodesMoneyEditor.editWindow = this._createEditWindow(scene);
            scene._cabbycodesMoneyEditor.editWindow.hide();
            scene._cabbycodesMoneyEditor.editWindow.deactivate();
        },

        detachScene(scene) {
            if (!scene || !scene._cabbycodesMoneyEditor) {
                return;
            }
            this.closeEditor(scene);
            scene._cabbycodesMoneyEditor.editWindow?.deactivate();
            scene._cabbycodesMoneyEditor = null;
            if (this.state && this.state.scene === scene) {
                this.state = null;
            }
        },

        setGoldWindow(windowInstance) {
            if (!windowInstance) {
                return;
            }
            windowInstance._cabbycodesMoneyEditorEnabled = true;
            windowInstance._cabbycodesMoneyButtonRect = null;
            if (typeof windowInstance.refresh === 'function') {
                windowInstance.refresh();
            }
        },

        update(scene) {
            if (!scene || this.isEditorOpen()) {
                return;
            }
            const goldWindow = scene._goldWindow;
            if (
                !goldWindow ||
                !goldWindow._cabbycodesMoneyEditorEnabled ||
                !goldWindow.visible ||
                goldWindow.openness < 255
            ) {
                return;
            }
            const rect = goldWindow._cabbycodesMoneyButtonRect;
            if (!rect || !TouchInput.isTriggered()) {
                return;
            }
            const pointer = pointerPositionInContents(goldWindow);
            if (pointer && rectContains(rect, pointer.x, pointer.y)) {
                SoundManager.playCursor();
                this.openEditor(scene);
            }
        },

        isEditorOpen() {
            return !!this.state;
        },

        openEditor(scene) {
            if (!scene) {
                return;
            }
            const editWindow = scene._cabbycodesMoneyEditor?.editWindow;
            if (!editWindow) {
                return;
            }
            const currentGold = $gameParty.gold();
            const maxGold = $gameParty.maxGold();
            editWindow.prepare(currentGold, maxGold);
            editWindow.show();
            editWindow.open();
            editWindow.activate();
            editWindow.select(0);
            this.state = { scene };
            this._deactivateSceneInputs(scene);
        },

        closeEditor(scene) {
            const targetScene = scene ?? this.state?.scene;
            const editWindow = targetScene?._cabbycodesMoneyEditor?.editWindow;
            if (editWindow) {
                editWindow.hide();
                editWindow.close();
                editWindow.deactivate();
            }
            this.state = null;
        },

        applyAmount(newAmount) {
            const target = clamp(Math.round(newAmount || 0), 0, $gameParty.maxGold());
            const delta = target - $gameParty.gold();
            if (delta !== 0) {
                $gameParty.gainGold(delta);
            }
            if (this.state?.scene?._goldWindow) {
                this.state.scene._goldWindow.refresh();
            }
            SoundManager.playOk();
            this._reactivateSceneInputs();
        },

        cancelEditing(playSound = true) {
            if (playSound) {
                SoundManager.playCancel();
            }
            this._reactivateSceneInputs();
        },

        _createEditWindow(scene) {
            const rect = this._editWindowRect(scene);
            const win = new Window_CabbyCodesMoneyEdit(rect);
            win.setHandlers({
                onApply: (_item, amount) => {
                    this.applyAmount(amount);
                },
                onCancel: () => {
                    this.cancelEditing();
                }
            });
            scene.addWindow(win);
            return win;
        },

        _editWindowRect(scene) {
            const width = 420;
            const baseHeight = scene?.calcWindowHeight ? scene.calcWindowHeight(2, true) : 0;
            const height = baseHeight + EDIT_MODAL_EXTRA_HEIGHT;
            const x = Math.max(0, (Graphics.boxWidth - width) / 2);
            const y = Math.max(0, (Graphics.boxHeight - height) / 2 - 32);
            return new Rectangle(x, y, width, height);
        },

        _deactivateSceneInputs(scene) {
            const targetScene = scene ?? this.state?.scene;
            if (!targetScene) {
                return;
            }
            targetScene._commandWindow?.deactivate();
            targetScene._statusWindow?.deactivate();
            targetScene._goldWindow?.deactivate();
        },

        _reactivateSceneInputs() {
            const scene = this.state?.scene;
            if (!scene) {
                return;
            }
            this.closeEditor(scene);
            scene._commandWindow?.activate();
            scene._statusWindow?.deselect?.();
        }
    };

    CabbyCodes.after(Scene_Menu.prototype, 'create', function() {
        MoneyEditor.attachScene(this);
    });

    CabbyCodes.after(Scene_Menu.prototype, 'createGoldWindow', function() {
        MoneyEditor.setGoldWindow(this._goldWindow);
    });

    CabbyCodes.after(Scene_Menu.prototype, 'terminate', function() {
        MoneyEditor.detachScene(this);
    });

    CabbyCodes.after(Scene_Menu.prototype, 'update', function() {
        MoneyEditor.update(this);
    });

    CabbyCodes.after(Window_Gold.prototype, 'initialize', function(rect) {
        this._cabbycodesMoneyEditorEnabled = false;
        this._cabbycodesMoneyButtonRect = null;
    });

    CabbyCodes.override(Window_Gold.prototype, 'refresh', function() {
        if (!this._cabbycodesMoneyEditorEnabled || !this.contents) {
            this._cabbycodesMoneyButtonRect = null;
            return CabbyCodes.callOriginal(Window_Gold.prototype, 'refresh', this, arguments);
        }
        const rect = this.itemLineRect(0);
        const { buttonRect, availableWidth } = computeButtonPlacement(rect);
        this.contents.clear();
        const value = this.value();
        const unit = this.currencyUnit();
        Window_Base.prototype.drawCurrencyValue.call(this, value, unit, rect.x, rect.y, availableWidth);
        drawEditButton(this, buttonRect, true);
        this._cabbycodesMoneyButtonRect = buttonRect;
    });

    function computeButtonPlacement(rect) {
        const buttonSpace = Math.max(BUTTON_MIN_SIZE, Math.floor(rect.height));
        const buttonSize = clamp(BUTTON_TARGET_SIZE, BUTTON_MIN_SIZE, Math.min(BUTTON_MAX_SIZE, buttonSpace));
        const buttonX = rect.x + rect.width - buttonSize;
        const buttonY = rect.y + Math.floor((rect.height - buttonSize) / 2);
        const availableWidth = Math.max(0, rect.width - buttonSize - BUTTON_GAP);
        return {
            buttonRect: new Rectangle(buttonX, buttonY, buttonSize, buttonSize),
            availableWidth
        };
    }

    function pointerPositionInContents(windowInstance) {
        if (!windowInstance || typeof TouchInput === 'undefined') {
            return null;
        }
        const touchPos = new Point(TouchInput.x, TouchInput.y);
        const local = windowInstance.worldTransform.applyInverse(touchPos);
        const x = windowInstance.origin.x + local.x - windowInstance.padding;
        const y = windowInstance.origin.y + local.y - windowInstance.padding;
        return { x, y };
    }

    function rectContains(rect, x, y) {
        return rect && x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    //-------------------------------------------------------------------------
    // Window_CabbyCodesMoneyEdit
    //-------------------------------------------------------------------------

    function Window_CabbyCodesMoneyEdit() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesMoneyEdit = Window_CabbyCodesMoneyEdit;

    Window_CabbyCodesMoneyEdit.prototype = Object.create(Window_CabbyCodesItemEdit.prototype);
    Window_CabbyCodesMoneyEdit.prototype.constructor = Window_CabbyCodesMoneyEdit;

    Window_CabbyCodesMoneyEdit.prototype.initialize = function(rect) {
        Window_CabbyCodesItemEdit.prototype.initialize.call(this, rect);
        this._currencyUnit = TextManager.currencyUnit || '$';
    };

    Window_CabbyCodesMoneyEdit.prototype.prepare = function(currentGold, maxGold) {
        this._item = null;
        this._min = 0;
        this._max = clamp(maxGold ?? $gameParty.maxGold(), 0, $gameParty.maxGold());
        this._quantity = clamp(currentGold ?? 0, this._min, this._max);
        this._typedDigits = null;
        this.refresh();
    };

    Window_CabbyCodesMoneyEdit.prototype.maxItems = function() {
        return 2;
    };

    Window_CabbyCodesMoneyEdit.prototype.itemRect = function(index) {
        const padding = this.itemPadding();
        const rowSpacing = this.rowSpacing();
        const scrollBaseX = this.scrollBaseX();
        const scrollBaseY = this.scrollBaseY();
        const quantityHeight = this._quantityRowHeight();
        const buttonHeight = this.lineHeight();
        const fullWidth = Math.max(0, this.innerWidth - padding * 2);
        const rect = new Rectangle(0, 0, 0, 0);
        if (index === 0) {
            rect.height = quantityHeight;
            rect.x = padding - scrollBaseX;
            rect.y = padding - scrollBaseY;
            rect.width = fullWidth;
            return rect;
        }
        rect.height = buttonHeight;
        const buttonWidth = Math.max(
            EDIT_MODAL_BUTTON_MIN_WIDTH,
            Math.min(fullWidth, Math.floor(fullWidth * 0.6))
        );
        rect.width = Math.min(fullWidth, buttonWidth);
        rect.x = padding - scrollBaseX + Math.floor((fullWidth - rect.width) / 2);
        rect.y = padding + quantityHeight + rowSpacing - scrollBaseY;
        return rect;
    };

    Window_CabbyCodesMoneyEdit.prototype.drawItem = function(index) {
        if (index === 0) {
            const rect = this.itemRect(index);
            this.drawQuantityRow(rect);
        } else if (index === 1) {
            const rect = this.itemLineRect(index);
            drawCenteredButton(this, rect, 'Accept');
        }
    };

    Window_CabbyCodesMoneyEdit.prototype.drawQuantityRow = function(rect) {
        this.resetTextColor();
        const infoHeight = this.lineHeight();
        const labelWidth = Math.min(200, Math.floor(rect.width * 0.45));
        const valueWidth = rect.width - labelWidth;
        this.changeTextColor(ColorManager.systemColor());
        this.drawText('Money', rect.x, rect.y, labelWidth, 'left');
        this.resetTextColor();
        const amountText = `${this._currencyUnit}${formatNumber(this._quantity)} / ${this._currencyUnit}${formatNumber(this._max)}`;
        this.drawText(amountText, rect.x + labelWidth, rect.y, valueWidth, 'right');

        const prevFontSize = this.contents.fontSize;
        const hintFontSize = Math.max(14, prevFontSize - 6);
        const hintOffset = Math.max(0, this.lineHeight() - hintFontSize);
        const hintY = rect.y + infoHeight + QUANTITY_HINT_MARGIN - hintOffset;
        this.contents.fontSize = hintFontSize;
        this.changeTextColor(ColorManager.systemColor());
        this.drawText('Type # or use <-/->', rect.x + labelWidth, hintY, valueWidth, 'right');
        this.contents.fontSize = prevFontSize;
        this.resetTextColor();
    };

    Window_CabbyCodesMoneyEdit.prototype.processOk = function() {
        if (this.index() === 0) {
            SoundManager.playCursor();
            this.select(1);
            return;
        }
        if (this.index() === 1 && typeof this._handlers.onApply === 'function') {
            this._handlers.onApply(null, this._quantity);
            return;
        }
        Window_CabbyCodesItemEdit.prototype.processOk.call(this);
    };

    Window_CabbyCodesMoneyEdit.prototype.cursorRight = function(wrap) {
        Window_Selectable.prototype.cursorRight.call(this, wrap);
    };

    Window_CabbyCodesMoneyEdit.prototype.cursorLeft = function(wrap) {
        Window_Selectable.prototype.cursorLeft.call(this, wrap);
    };

    Window_CabbyCodesMoneyEdit.prototype.cursorUp = function(wrap) {
        Window_Selectable.prototype.cursorUp.call(this, wrap);
    };

    Window_CabbyCodesMoneyEdit.prototype.cursorDown = function(wrap) {
        Window_Selectable.prototype.cursorDown.call(this, wrap);
    };

    function drawCenteredButton(windowInstance, rect, label) {
        const contents = windowInstance.contents;
        if (!contents) {
            return;
        }
        contents.fillRect(rect.x, rect.y, rect.width, rect.height, BUTTON_BORDER);
        contents.fillRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2, BUTTON_COLOR);
        windowInstance.changeTextColor(BUTTON_HIGHLIGHT);
        windowInstance.drawText(label, rect.x, rect.y, rect.width, 'center');
        windowInstance.resetTextColor();
    }

    function drawEditButton(windowInstance, rect, enabled) {
        const contents = windowInstance.contents;
        if (!contents) {
            return;
        }
        const previousOpacity = contents.paintOpacity;
        contents.paintOpacity = enabled ? 255 : 200;
        contents.fillRect(rect.x, rect.y, rect.width, rect.height, BUTTON_BORDER);
        contents.fillRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2, BUTTON_COLOR);
        contents.paintOpacity = previousOpacity;
        drawEditIcon(windowInstance, rect, enabled);
    }

    function drawEditIcon(windowInstance, rect, enabled) {
        const contents = windowInstance.contents;
        const ctx = contents?.context;
        if (!ctx) {
            return;
        }

        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;
        const iconSize = Math.min(rect.width, rect.height) - 6;
        if (iconSize <= 0) {
            return;
        }

        const colors = enabled
            ? {
                  sheetFill: '#101926',
                  sheetBorder: '#2b3a4c',
                  sheetShadow: 'rgba(0, 0, 0, 0.3)',
                  pencilLight: '#ffd166',
                  pencilDark: '#f4a259',
                  ferrule: '#cdd6f4',
                  eraser: '#fca5a5',
                  wood: '#ffe8b5',
                  lead: '#0f172a'
              }
            : {
                  sheetFill: '#161e2a',
                  sheetBorder: '#2a3342',
                  sheetShadow: 'rgba(0, 0, 0, 0.2)',
                  pencilLight: '#d9dce5',
                  pencilDark: '#9aa6b8',
                  ferrule: '#bfc5d6',
                  eraser: '#c9ced6',
                  wood: '#d7dae2',
                  lead: '#4b5563'
              };

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.globalAlpha = enabled ? 1 : BUTTON_HOVER_ALPHA;

        const sheetSize = iconSize * 0.78;
        const sheetRadius = Math.max(3, sheetSize * 0.2);
        ctx.fillStyle = colors.sheetShadow;
        ctx.beginPath();
        drawRoundedRectPath(ctx, -(sheetSize / 2) + 2, -(sheetSize / 2) + 2, sheetSize, sheetSize, sheetRadius);
        ctx.fill();

        ctx.fillStyle = colors.sheetFill;
        ctx.strokeStyle = colors.sheetBorder;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        drawRoundedRectPath(ctx, -sheetSize / 2, -sheetSize / 2, sheetSize, sheetSize, sheetRadius);
        ctx.fill();
        ctx.stroke();

        ctx.save();
        ctx.rotate(-Math.PI / 4);
        const pencilWidth = Math.max(4, iconSize * 0.22);
        const pencilLength = iconSize * 1.05;
        const tipLength = pencilLength * 0.18;
        const ferruleLength = Math.max(4, pencilLength * 0.1);
        const eraserLength = Math.max(4, pencilLength * 0.12);
        const shaftLength = Math.max(6, pencilLength - (tipLength + ferruleLength + eraserLength));
        const startX = -pencilLength / 2;

        ctx.fillStyle = colors.eraser;
        ctx.fillRect(startX, -pencilWidth / 2, eraserLength, pencilWidth);

        ctx.fillStyle = colors.ferrule;
        ctx.fillRect(startX + eraserLength, -pencilWidth / 2, ferruleLength, pencilWidth);

        const shaftX = startX + eraserLength + ferruleLength;
        ctx.fillStyle = colors.pencilDark;
        ctx.fillRect(shaftX, -pencilWidth / 2, shaftLength, pencilWidth);

        ctx.fillStyle = colors.pencilLight;
        ctx.fillRect(shaftX, -pencilWidth * 0.2, shaftLength, pencilWidth * 0.4);

        const tipStart = shaftX + shaftLength;
        ctx.fillStyle = colors.wood;
        ctx.beginPath();
        ctx.moveTo(tipStart, -pencilWidth / 2);
        ctx.lineTo(tipStart + tipLength, 0);
        ctx.lineTo(tipStart, pencilWidth / 2);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = colors.lead;
        ctx.beginPath();
        ctx.moveTo(tipStart + tipLength * 0.55, -pencilWidth / 2);
        ctx.lineTo(tipStart + tipLength, 0);
        ctx.lineTo(tipStart + tipLength * 0.55, pencilWidth / 2);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
        ctx.restore();
        contents._baseTexture?.update();
    }

    function drawRoundedRectPath(ctx, x, y, width, height, radius) {
        const r = Math.max(0, Math.min(radius, width / 2, height / 2));
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

    function formatNumber(value) {
        const str = String(Math.max(0, Math.floor(value)));
        return str.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    CabbyCodes.log('[CabbyCodes] Money editor loaded');
})();


