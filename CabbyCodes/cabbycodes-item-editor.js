//=============================================================================
// CabbyCodes Item Editor
//=============================================================================
/*:
 * @target MZ
 * @plugindesc Adds inline edit buttons in the inventory UI to adjust or delete items.
 * @author CabbyCodes
 * @help
 * Displays an Edit button next to each item inside the Scene_Item window. Players
 * can change the item quantity (between 1 and the item's cap) or delete the item
 * entirely after confirming.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Item editor requires the core module.');
        return;
    }

    const BUTTON_TARGET_SIZE = 40;
    const BUTTON_MIN_SIZE = 30;
    const BUTTON_MAX_SIZE = 46;
    const BUTTON_GAP = 8;
    const BUTTON_COLOR = '#1f2b38';
    const BUTTON_HIGHLIGHT = '#3ec793';
    const BUTTON_BORDER = '#0b1118';
    const EDIT_MODAL_BUTTON_GAP = 24;
    const EDIT_MODAL_BUTTON_MIN_WIDTH = 120;
    const QUANTITY_HINT_EXTRA_HEIGHT = 18;
    const QUANTITY_HINT_MARGIN = 4;
    const EDIT_MODAL_EXTRA_HEIGHT = QUANTITY_HINT_EXTRA_HEIGHT + 4;

    const ItemEditor = {
        trackedWindows: new WeakSet(),
        buttonRects: new WeakMap(),
        sceneState: null,

        registerItemWindow(windowInstance, scene) {
            if (!windowInstance || !scene) {
                return;
            }
            windowInstance._cabbycodesItemEditorEnabled = true;
            windowInstance._cabbycodesItemEditorScene = scene;
            this.trackedWindows.add(windowInstance);
            if (!this.buttonRects.has(windowInstance)) {
                this.buttonRects.set(windowInstance, new Map());
            }
        },

        unregisterItemWindow(windowInstance) {
            if (!windowInstance) {
                return;
            }
            windowInstance._cabbycodesItemEditorEnabled = false;
            windowInstance._cabbycodesItemEditorScene = null;
            const rectStore = this.buttonRects.get(windowInstance);
            if (rectStore) {
                rectStore.clear();
            }
        },

        resetButtonRects(windowInstance) {
            const store = this.buttonRects.get(windowInstance);
            if (store) {
                store.clear();
            }
        },

        storeButtonRect(windowInstance, index, rect) {
            if (!windowInstance) {
                return;
            }
            const store = this.buttonRects.get(windowInstance);
            if (store) {
                store.set(index, rect);
            }
        },

        // Returns true when a button consumed the touch/click event.
        tryHandleButtonTouch(windowInstance) {
            if (!windowInstance) {
                return false;
            }
            const pointer = pointerPositionInContents(windowInstance);
            if (!pointer) {
                return false;
            }
            const store = this.buttonRects.get(windowInstance);
            if (!store || store.size === 0) {
                return false;
            }
            for (const [index, rect] of store.entries()) {
                if (rectContains(rect, pointer.x, pointer.y)) {
                    const item = windowInstance.itemAt(index);
                    if (item) {
                        this.openEditorFor(windowInstance, index, item);
                        return true;
                    }
                }
            }
            return false;
        },

        openEditorFor(windowInstance, index, item) {
            const scene = windowInstance._cabbycodesItemEditorScene;
            if (!scene || !scene._cabbycodesItemEditor) {
                return;
            }
            const editor = scene._cabbycodesItemEditor.editWindow;
            if (!editor) {
                return;
            }
            const count = $gameParty.numItems(item);
            const cap = $gameParty.maxItems(item);
            editor.prepare(item, count, Math.max(1, cap));
            editor.show();
            editor.open();
            editor.activate();
            editor.select(0);

            this.sceneState = {
                scene,
                itemWindow: windowInstance,
                itemIndex: index,
                item
            };
            this.deactivateSceneInputs(scene);
        },

        deactivateSceneInputs(scene) {
            if (!scene) {
                return;
            }
            scene._itemWindow?.deactivate();
            scene._categoryWindow?.deactivate();
            scene._actorWindow?.deactivate();
        },

        reactivateSceneInputs() {
            if (!this.sceneState) {
                return;
            }
            const { scene, itemWindow, itemIndex } = this.sceneState;
            if (scene && itemWindow) {
                const max = itemWindow.maxItems();
                const index = Math.min(Math.max(itemIndex, 0), Math.max(0, max - 1));
                itemWindow.select(index);
                itemWindow.activate();
            }
            this.sceneState = null;
        },

        closeEditor(scene) {
            const editor = scene?._cabbycodesItemEditor?.editWindow;
            if (editor) {
                editor.hide();
                editor.close();
                editor.deactivate();
            }
        },

        closeConfirm(scene) {
            const confirmWindow = scene?._cabbycodesItemEditor?.confirmWindow;
            if (confirmWindow) {
                confirmWindow.hide();
                confirmWindow.close();
                confirmWindow.deactivate();
            }
        },

        applyQuantityChange(newQuantity) {
            if (!this.sceneState) {
                return;
            }
            const { item } = this.sceneState;
            const currentCount = $gameParty.numItems(item);
            const targetQuantity = Math.max(1, newQuantity);
            const delta = targetQuantity - currentCount;
            if (delta !== 0) {
                $gameParty.gainItem(item, delta);
            }
            this.refreshSceneData();
            this.reactivateSceneInputs();
        },

        requestDeleteConfirmation() {
            if (!this.sceneState) {
                return;
            }
            const { scene, item } = this.sceneState;
            const confirmWindow = scene?._cabbycodesItemEditor?.confirmWindow;
            if (!confirmWindow) {
                return;
            }
            confirmWindow.setItem(item);
            confirmWindow.show();
            confirmWindow.open();
            confirmWindow.activate();
        confirmWindow.select(1);
            this.closeEditor(scene);
        },

        confirmDeletion() {
            if (!this.sceneState) {
                return;
            }
            const { item } = this.sceneState;
            const currentCount = $gameParty.numItems(item);
            if (currentCount > 0) {
                $gameParty.gainItem(item, -currentCount);
            }
            this.refreshSceneData();
            this.reactivateSceneInputs();
        },

        cancelDeletion() {
            if (!this.sceneState) {
                return;
            }
            const { scene, item } = this.sceneState;
            const editor = scene?._cabbycodesItemEditor?.editWindow;
            if (editor) {
                const count = $gameParty.numItems(item);
                const cap = $gameParty.maxItems(item);
                editor.prepare(item, count, Math.max(1, cap));
                editor.show();
                editor.open();
                editor.activate();
                editor.select(0);
            }
            this.closeConfirm(scene);
        },

        refreshSceneData() {
            if (!this.sceneState) {
                return;
            }
            const { scene, itemWindow, itemIndex } = this.sceneState;
            if (!scene || !itemWindow) {
                return;
            }
            itemWindow.refresh();
            if (typeof itemIndex === 'number') {
                itemWindow.redrawItem(itemIndex);
            } else {
                itemWindow.redrawCurrentItem();
            }
            this.closeEditor(scene);
            this.closeConfirm(scene);
        }
    };

    CabbyCodes.itemEditor = ItemEditor;

    //-------------------------------------------------------------------------
    // Window helpers
    //-------------------------------------------------------------------------

    function ensureItemEditorData(windowInstance) {
        if (!windowInstance._cabbycodesItemEditorData) {
            windowInstance._cabbycodesItemEditorData = {
                buttonRects: new Map()
            };
        }
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
        if (!rect) {
            return false;
        }
        return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
    }

    function drawEditButton(windowInstance, rect, enabled) {
        const contents = windowInstance.contents;
        if (!contents || !rect) {
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
        ctx.globalAlpha = enabled ? 1 : 0.8;

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
        // Rotate 180 degrees so the pencil icon flips direction
        ctx.rotate((-Math.PI / 4) + Math.PI);
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

    //-------------------------------------------------------------------------
    // Scene hooks
    //-------------------------------------------------------------------------

    CabbyCodes.after(Scene_Item.prototype, 'create', function() {
        if (!this._cabbycodesItemEditor) {
            this._cabbycodesItemEditor = {};
        }
        this._cabbycodesItemEditor.editWindow = createItemEditWindow(this);
        this._cabbycodesItemEditor.confirmWindow = createDeleteConfirmWindow(this);
    });

    CabbyCodes.after(Scene_Item.prototype, 'createItemWindow', function() {
        ItemEditor.registerItemWindow(this._itemWindow, this);
    });

    CabbyCodes.after(Scene_Item.prototype, 'terminate', function() {
        if (this._cabbycodesItemEditor) {
            ItemEditor.closeEditor(this);
            ItemEditor.closeConfirm(this);
        }
        if (this._itemWindow) {
            ItemEditor.unregisterItemWindow(this._itemWindow);
        }
        ItemEditor.sceneState = null;
    });

    function createItemEditWindow(scene) {
        const rect = editWindowRect(scene);
        const win = new Window_CabbyCodesItemEdit(rect);
        win.setHandlers({
            onApply: (item, quantity) => {
                ItemEditor.applyQuantityChange(quantity);
                SoundManager.playOk();
            },
            onDelete: () => {
                SoundManager.playCursor();
                ItemEditor.requestDeleteConfirmation();
            },
            onCancel: () => {
                SoundManager.playCancel();
                ItemEditor.closeEditor(scene);
                ItemEditor.reactivateSceneInputs();
            }
        });
        scene.addWindow(win);
        win.hide();
        win.deactivate();
        return win;
    }

    function createDeleteConfirmWindow(scene) {
        const rect = confirmWindowRect(scene);
        const win = new Window_CabbyCodesDeleteConfirm(rect);
        win.setHandler('confirm', () => {
            SoundManager.playOk();
            ItemEditor.confirmDeletion();
        });
        win.setHandler('cancel', () => {
            SoundManager.playCancel();
            ItemEditor.cancelDeletion();
        });
        scene.addWindow(win);
        win.hide();
        win.deactivate();
        return win;
    }

    function editWindowRect(scene) {
        const width = 420;
        const baseHeight = scene.calcWindowHeight(2, true);
        const height = baseHeight + EDIT_MODAL_EXTRA_HEIGHT;
        const x = Math.max(0, (Graphics.boxWidth - width) / 2);
        const y = Math.max(0, (Graphics.boxHeight - height) / 2 - 48);
        return new Rectangle(x, y, width, height);
    }

    function confirmWindowRect(scene) {
        const width = 360;
        const height = scene.calcWindowHeight(2, true);
        const x = Math.max(0, (Graphics.boxWidth - width) / 2);
        const y = Math.max(0, (Graphics.boxHeight - height) / 2 + 60);
        return new Rectangle(x, y, width, height);
    }

    //-------------------------------------------------------------------------
    // Window_ItemList overrides
    //-------------------------------------------------------------------------

    CabbyCodes.after(Window_ItemList.prototype, 'initialize', function() {
        ensureItemEditorData(this);
        this._cabbycodesItemEditorEnabled = false;
        this._cabbycodesItemEditorScene = null;
    });

    CabbyCodes.before(Window_ItemList.prototype, 'refresh', function() {
        if (!this._cabbycodesItemEditorEnabled) {
            return;
        }
        ensureItemEditorData(this);
        ItemEditor.resetButtonRects(this);
    });

    CabbyCodes.override(Window_ItemList.prototype, 'drawItem', function(index) {
        if (!this._cabbycodesItemEditorEnabled) {
            return CabbyCodes.callOriginal(Window_ItemList.prototype, 'drawItem', this, arguments);
        }

        const item = this.itemAt(index);
        if (!item) {
            return;
        }

        const rect = this.itemLineRect(index);
        const buttonSpace = Math.max(28, Math.floor(rect.width * 0.25));
        const buttonHeight = Math.max(28, Math.min(rect.height - 4, this.lineHeight() - 4));
        const maxAvailable = Math.max(BUTTON_MIN_SIZE, Math.min(BUTTON_MAX_SIZE, buttonSpace, buttonHeight));
        const buttonSize = clamp(BUTTON_TARGET_SIZE, BUTTON_MIN_SIZE, maxAvailable);
        const buttonRect = new Rectangle(
            rect.x + rect.width - buttonSize,
            rect.y + Math.floor((rect.height - buttonSize) / 2),
            buttonSize,
            buttonSize
        );
        ItemEditor.storeButtonRect(this, index, buttonRect);

        const numberWidth = this.numberWidth();
        const contentWidth = Math.max(0, rect.width - buttonRect.width - BUTTON_GAP);
        const nameWidth = Math.max(0, contentWidth - numberWidth);

        this.changePaintOpacity(true);
        drawEditButton(this, buttonRect, true);
        this.changePaintOpacity(this.isEnabled(item));
        this.drawItemName(item, rect.x, rect.y, nameWidth);
        this.drawItemNumber(item, rect.x, rect.y, contentWidth);
        this.changePaintOpacity(true);
    });

    CabbyCodes.override(Window_ItemList.prototype, 'onTouchOk', function() {
        if (this._cabbycodesItemEditorEnabled && ItemEditor.tryHandleButtonTouch(this)) {
            return;
        }
        return CabbyCodes.callOriginal(Window_ItemList.prototype, 'onTouchOk', this, arguments);
    });

    //-------------------------------------------------------------------------
    // Item edit window
    //-------------------------------------------------------------------------

    function Window_CabbyCodesItemEdit() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesItemEdit = Window_CabbyCodesItemEdit;

    Window_CabbyCodesItemEdit.prototype = Object.create(Window_Selectable.prototype);
    Window_CabbyCodesItemEdit.prototype.constructor = Window_CabbyCodesItemEdit;

    Window_CabbyCodesItemEdit.prototype.initialize = function(rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._item = null;
        this._min = 1;
        this._max = 1;
        this._quantity = 1;
        this._handlers = { onApply: null, onDelete: null, onCancel: null };
        this._typedDigits = null;
        this._listeningForTyping = false;
        this._boundTypingHandler = null;
    };

    Window_CabbyCodesItemEdit.prototype.destroy = function(options) {
        this._stopTypingListener();
        Window_Selectable.prototype.destroy.call(this, options);
    };

    Window_CabbyCodesItemEdit.prototype.activate = function() {
        Window_Selectable.prototype.activate.call(this);
        this._startTypingListener();
    };

    Window_CabbyCodesItemEdit.prototype.deactivate = function() {
        this._stopTypingListener();
        Window_Selectable.prototype.deactivate.call(this);
    };

    Window_CabbyCodesItemEdit.prototype.setHandlers = function(handlers) {
        this._handlers = Object.assign({}, this._handlers, handlers);
    };

    Window_CabbyCodesItemEdit.prototype.prepare = function(item, currentQuantity, maxQuantity) {
        this._item = item;
        this._min = 1;
        this._max = Math.max(1, maxQuantity);
        this._quantity = clamp(currentQuantity, this._min, this._max);
        this._typedDigits = null;
        this.refresh();
    };

    Window_CabbyCodesItemEdit.prototype.maxItems = function() {
        return 3;
    };

    Window_CabbyCodesItemEdit.prototype.maxRows = function() {
        return 2;
    };

    Window_CabbyCodesItemEdit.prototype._quantityRowHeight = function() {
        return this.lineHeight() + QUANTITY_HINT_EXTRA_HEIGHT;
    };

    Window_CabbyCodesItemEdit.prototype.itemRect = function(index) {
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
        const gap = Math.min(EDIT_MODAL_BUTTON_GAP, Math.max(0, fullWidth - 2));
        const halfWidth = Math.max(1, Math.floor(fullWidth / 2));
        const tentativeWidth = Math.floor((fullWidth - gap) / 2);
        const buttonWidth = Math.max(
            1,
            Math.min(halfWidth, Math.max(EDIT_MODAL_BUTTON_MIN_WIDTH, tentativeWidth))
        );
        const spacing = Math.max(0, Math.min(gap, fullWidth - buttonWidth * 2));
        const baseX = padding - scrollBaseX;
        const baseY = padding + quantityHeight + rowSpacing - scrollBaseY;
        rect.width = buttonWidth;
        rect.y = baseY;
        if (index === 1) {
            rect.x = baseX;
        } else {
            let deleteX = baseX + buttonWidth + spacing;
            const maxX = baseX + Math.max(0, fullWidth - buttonWidth);
            if (deleteX > maxX) {
                deleteX = maxX;
            }
            rect.x = deleteX;
        }
        return rect;
    };

    Window_CabbyCodesItemEdit.prototype.itemRectWithPadding = function(index) {
        const rect = this.itemRect(index);
        return new Rectangle(rect.x, rect.y, rect.width, rect.height);
    };

    Window_CabbyCodesItemEdit.prototype.drawItem = function(index) {
        const rect = index === 0 ? this.itemRect(index) : this.itemLineRect(index);
        if (index === 0) {
            this.drawQuantityRow(rect);
        } else if (index === 1) {
            drawCenteredButton(this, rect, 'Accept');
        } else if (index === 2) {
            drawCenteredButton(this, rect, 'Delete');
        }
    };

    Window_CabbyCodesItemEdit.prototype.drawQuantityRow = function(rect) {
        this.resetTextColor();
        const infoHeight = this.lineHeight();
        const quantityAreaWidth = Math.min(
            Math.max(160, Math.floor(rect.width * 0.45)),
            rect.width
        );
        const nameAreaWidth = Math.max(0, rect.width - quantityAreaWidth);
        const iconX = rect.x;
        const iconY = rect.y + (infoHeight - ImageManager.iconHeight) / 2;
        const textX = iconX + ImageManager.iconWidth + 8;
        const textWidth = Math.max(60, nameAreaWidth - (ImageManager.iconWidth + 8));

        if (this._item) {
            this.drawIcon(this._item.iconIndex, iconX, iconY);
            this.drawText(this._item.name, textX, rect.y, textWidth);
        } else {
            this.drawText('Item', rect.x, rect.y, nameAreaWidth);
        }

        const quantityX = rect.x + nameAreaWidth;
        const quantityText = `Qty: ${this._quantity}/${this._max}`;
        this.drawText(quantityText, quantityX, rect.y, quantityAreaWidth, 'right');

        const prevFontSize = this.contents.fontSize;
        const hintFontSize = Math.max(14, prevFontSize - 6);
        const hintOffset = Math.max(0, this.lineHeight() - hintFontSize);
        const hintY = rect.y + infoHeight + QUANTITY_HINT_MARGIN - hintOffset;
        this.contents.fontSize = hintFontSize;
        this.changeTextColor(ColorManager.systemColor());
        this.drawText('Type # or use <-/->', quantityX, hintY, quantityAreaWidth, 'right');
        this.contents.fontSize = prevFontSize;
        this.resetTextColor();
    };

    Window_CabbyCodesItemEdit.prototype.processOk = function() {
        const index = this.index();
        if (index === 0) {
            SoundManager.playCursor();
            this.select(1);
            return;
        }
        if (index === 1 && typeof this._handlers.onApply === 'function') {
            this._handlers.onApply(this._item, this._quantity);
        } else if (index === 2 && typeof this._handlers.onDelete === 'function') {
            this._handlers.onDelete(this._item, this._quantity);
        } else {
            Window_Selectable.prototype.processOk.call(this);
        }
    };

    Window_CabbyCodesItemEdit.prototype.processCancel = function() {
        if (typeof this._handlers.onCancel === 'function') {
            this._handlers.onCancel(this._item);
            return;
        }
        Window_Selectable.prototype.processCancel.call(this);
    };

    Window_CabbyCodesItemEdit.prototype.isOkEnabled = function() {
        return true;
    };

    Window_CabbyCodesItemEdit.prototype.isCancelEnabled = function() {
        return true;
    };

    Window_CabbyCodesItemEdit.prototype.isTouchOkEnabled = function() {
        return this.isOkEnabled();
    };

    Window_CabbyCodesItemEdit.prototype.cursorRight = function(wrap) {
        if (this.index() === 1) {
            this.smoothSelect(2);
        } else {
            Window_Selectable.prototype.cursorRight.call(this, wrap);
        }
    };

    Window_CabbyCodesItemEdit.prototype.cursorLeft = function(wrap) {
        if (this.index() === 2) {
            this.smoothSelect(1);
        } else {
            Window_Selectable.prototype.cursorLeft.call(this, wrap);
        }
    };

    Window_CabbyCodesItemEdit.prototype.processHandling = function() {
        if (this.isOpenAndActive() && this.index() === 0) {
            if (Input.isRepeated('right')) {
                this.adjustQuantity(1);
                return;
            } else if (Input.isRepeated('left')) {
                this.adjustQuantity(-1);
                return;
            }
        }
        Window_Selectable.prototype.processHandling.call(this);
    };

    Window_CabbyCodesItemEdit.prototype.adjustQuantity = function(delta) {
        const newQuantity = clamp(this._quantity + delta, this._min, this._max);
        this._typedDigits = null;
        if (newQuantity !== this._quantity) {
            this._quantity = newQuantity;
            SoundManager.playCursor();
            this.redrawItem(0);
        }
    };

    Window_CabbyCodesItemEdit.prototype._startTypingListener = function() {
        if (this._listeningForTyping || typeof window === 'undefined') {
            return;
        }
        if (!this._boundTypingHandler) {
            this._boundTypingHandler = this._onTypingKeyDown.bind(this);
        }
        window.addEventListener('keydown', this._boundTypingHandler);
        this._listeningForTyping = true;
    };

    Window_CabbyCodesItemEdit.prototype._stopTypingListener = function() {
        if (!this._listeningForTyping || typeof window === 'undefined' || !this._boundTypingHandler) {
            return;
        }
        window.removeEventListener('keydown', this._boundTypingHandler);
        this._listeningForTyping = false;
    };

    Window_CabbyCodesItemEdit.prototype._onTypingKeyDown = function(event) {
        if (!this.isOpenAndActive() || this.index() !== 0) {
            return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }
        const isDigit = /^[0-9]$/.test(event.key);
        const isNumpadDigit = typeof event.code === 'string' && /^Numpad[0-9]$/.test(event.code);
        if (isDigit || isNumpadDigit) {
            event.preventDefault();
            const digit = isDigit ? event.key : event.code.replace('Numpad', '');
            this._handleDigitInput(digit);
        } else if (event.key === 'Backspace') {
            event.preventDefault();
            this._handleBackspaceInput();
        }
    };

    Window_CabbyCodesItemEdit.prototype._handleDigitInput = function(digit) {
        const currentDigits = this._typedDigits ?? '';
        if (currentDigits.length >= this._maxDigitCount()) {
            SoundManager.playBuzzer();
            return;
        }
        const combined = (currentDigits + digit).slice(0, this._maxDigitCount());
        const normalized = combined.replace(/^0+(?=\d)/, '') || '0';
        const numeric = Number(normalized) || 0;
        const clamped = clamp(numeric, this._min, this._max);
        this._typedDigits = numeric > this._max ? String(clamped) : normalized;
        const previous = this._quantity;
        this._quantity = clamped;
        this.redrawItem(0);
        if (clamped !== previous) {
            SoundManager.playCursor();
        } else if (numeric > this._max) {
            SoundManager.playBuzzer();
        }
    };

    Window_CabbyCodesItemEdit.prototype._handleBackspaceInput = function() {
        if (this._typedDigits === null) {
            this._typedDigits = String(this._quantity);
        }
        if (!this._typedDigits || this._typedDigits.length === 0) {
            return;
        }
        this._typedDigits = this._typedDigits.slice(0, -1);
        if (!this._typedDigits.length) {
            this._typedDigits = null;
            const previous = this._quantity;
            this._quantity = this._min;
            this.redrawItem(0);
            if (previous !== this._quantity) {
                SoundManager.playCursor();
            }
            return;
        }
        const numeric = Number(this._typedDigits) || 0;
        const clamped = clamp(numeric, this._min, this._max);
        if (numeric > this._max) {
            this._typedDigits = String(clamped);
        }
        const previous = this._quantity;
        this._quantity = clamped;
        this.redrawItem(0);
        if (previous !== this._quantity) {
            SoundManager.playCursor();
        }
    };

    Window_CabbyCodesItemEdit.prototype._maxDigitCount = function() {
        return String(this._max).length;
    };

    //-------------------------------------------------------------------------
    // Delete confirmation window
    //-------------------------------------------------------------------------

    function Window_CabbyCodesDeleteConfirm() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesDeleteConfirm = Window_CabbyCodesDeleteConfirm;

    Window_CabbyCodesDeleteConfirm.prototype = Object.create(Window_Selectable.prototype);
    Window_CabbyCodesDeleteConfirm.prototype.constructor = Window_CabbyCodesDeleteConfirm;

    Window_CabbyCodesDeleteConfirm.prototype.initialize = function(rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._item = null;
        this._commands = [
            { symbol: null, name: '', isHeader: true },
            { symbol: 'confirm', name: 'Delete' },
            { symbol: 'cancel', name: 'Keep' }
        ];
    };

    Window_CabbyCodesDeleteConfirm.prototype.maxRows = function() {
        return 2;
    };

    Window_CabbyCodesDeleteConfirm.prototype.setItem = function(item) {
        this._item = item;
        this.refresh();
    };

    Window_CabbyCodesDeleteConfirm.prototype.maxItems = function() {
        return this._commands.length;
    };

    Window_CabbyCodesDeleteConfirm.prototype.itemRect = function(index) {
        const padding = this.itemPadding();
        const lineHeight = this.lineHeight();
        const rowSpacing = this.rowSpacing();
        const scrollBaseX = this.scrollBaseX();
        const scrollBaseY = this.scrollBaseY();
        const fullWidth = Math.max(0, this.innerWidth - padding * 2);
        const rect = new Rectangle(0, 0, 0, 0);
        rect.height = lineHeight;
        if (index === 0) {
            rect.x = padding - scrollBaseX;
            rect.y = padding - scrollBaseY;
            rect.width = fullWidth;
            return rect;
        }
        const gap = Math.min(EDIT_MODAL_BUTTON_GAP, Math.max(0, fullWidth - 2));
        const halfWidth = Math.max(1, Math.floor(fullWidth / 2));
        const tentativeWidth = Math.floor((fullWidth - gap) / 2);
        const buttonWidth = Math.max(
            1,
            Math.min(halfWidth, Math.max(EDIT_MODAL_BUTTON_MIN_WIDTH, tentativeWidth))
        );
        const spacing = Math.max(0, Math.min(gap, fullWidth - buttonWidth * 2));
        const baseX = padding - scrollBaseX;
        const baseY = padding + lineHeight + rowSpacing - scrollBaseY;
        rect.width = buttonWidth;
        rect.y = baseY;
        if (index === 1) {
            rect.x = baseX;
        } else {
            let keepX = baseX + buttonWidth + spacing;
            const maxX = baseX + Math.max(0, fullWidth - buttonWidth);
            if (keepX > maxX) {
                keepX = maxX;
            }
            rect.x = keepX;
        }
        return rect;
    };

    Window_CabbyCodesDeleteConfirm.prototype.itemRectWithPadding = function(index) {
        const rect = this.itemRect(index);
        return new Rectangle(rect.x, rect.y, rect.width, rect.height);
    };

    Window_CabbyCodesDeleteConfirm.prototype.drawItemBackground = function(index) {
        if (index === 0) {
            return;
        }
        Window_Selectable.prototype.drawItemBackground.call(this, index);
    };

    Window_CabbyCodesDeleteConfirm.prototype.refreshCursor = function() {
        if (this._cursorAll) {
            this.refreshCursorForAll();
        } else if (this.index() >= 1) {
            const rect = this.itemRect(this.index());
            this.setCursorRect(rect.x, rect.y, rect.width, rect.height);
        } else {
            this.setCursorRect(0, 0, 0, 0);
        }
    };

    Window_CabbyCodesDeleteConfirm.prototype.drawItem = function(index) {
        const rect = this.itemRect(index);
        const command = this._commands[index];
        if (!command) {
            return;
        }
        if (index === 0) {
            const label = this._item ? `Remove ${this._item.name}?` : 'Remove this item?';
            this.drawHeaderRow(rect, label);
        } else {
            drawCenteredButton(this, rect, command.name);
        }
    };

    Window_CabbyCodesDeleteConfirm.prototype.drawHeaderRow = function(rect, label) {
        this.resetTextColor();
        const prevFontSize = this.contents.fontSize;
        this.contents.fontSize = Math.max(20, prevFontSize - 2);
        this.changeTextColor(ColorManager.systemColor());
        this.drawText(label, rect.x + 6, rect.y, rect.width - 12, 'left');
        this.contents.fontSize = prevFontSize;
        this.resetTextColor();
    };

    Window_CabbyCodesDeleteConfirm.prototype.processOk = function() {
        const index = this.index();
        if (index === 0) {
            this.select(1);
            return;
        }
        const command = this._commands[index];
        if (!command || !command.symbol) {
            Window_Selectable.prototype.processOk.call(this);
            return;
        }
        this.playOkSound();
        this.updateInputData();
        this.deactivate();
        this.callHandler(command.symbol);
    };

    Window_CabbyCodesDeleteConfirm.prototype.isCurrentItemEnabled = function() {
        return this.index() !== 0;
    };

    Window_CabbyCodesDeleteConfirm.prototype.cursorRight = function(/*wrap*/) {
        if (this.index() === 1) {
            this.smoothSelect(2);
        } else {
            this.select(1);
        }
    };

    Window_CabbyCodesDeleteConfirm.prototype.cursorLeft = function(wrap) {
        if (this.index() === 2) {
            this.smoothSelect(1);
        } else {
            this.select(1);
        }
    };

    Window_CabbyCodesDeleteConfirm.prototype.cursorUp = function(/*wrap*/) {
        if (this.index() >= 2) {
            this.smoothSelect(1);
        } else {
            this.select(1);
        }
    };

    Window_CabbyCodesDeleteConfirm.prototype.cursorDown = function(/*wrap*/) {
        if (this.index() === 1) {
            this.smoothSelect(2);
        } else {
            this.select(1);
        }
    };

    Window_CabbyCodesDeleteConfirm.prototype.isOkEnabled = function() {
        return true;
    };

    Window_CabbyCodesDeleteConfirm.prototype.isTouchOkEnabled = function() {
        return this.isOkEnabled();
    };

    //-------------------------------------------------------------------------
    // Shared helpers
    //-------------------------------------------------------------------------

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

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    CabbyCodes.log('[CabbyCodes] Item editor loaded');
})();

