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

    const BUTTON_WIDTH = 48;
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
        const prevOpacity = contents.paintOpacity;
        contents.paintOpacity = enabled ? 255 : 160;
        contents.fillRect(rect.x, rect.y, rect.width, rect.height, BUTTON_BORDER);
        contents.fillRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2, BUTTON_COLOR);
        contents.paintOpacity = prevOpacity;
        windowInstance.changeTextColor(enabled ? BUTTON_HIGHLIGHT : '#9aa5b5');
        windowInstance.drawText('Edit', rect.x, rect.y, rect.width, 'center');
        windowInstance.resetTextColor();
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
        const buttonWidth = Math.min(BUTTON_WIDTH, Math.max(32, rect.width / 5));
        const buttonHeight = Math.min(rect.height - 6, this.lineHeight() - 4);
        const buttonRect = new Rectangle(
            rect.x,
            rect.y + Math.floor((rect.height - buttonHeight) / 2),
            buttonWidth,
            buttonHeight
        );
        ItemEditor.storeButtonRect(this, index, buttonRect);

        const numberWidth = this.numberWidth();
        const offsetX = rect.x + buttonWidth + BUTTON_GAP;
        const contentWidth = Math.max(0, rect.width - buttonWidth - BUTTON_GAP);
        const nameWidth = Math.max(0, contentWidth - numberWidth);

        this.changePaintOpacity(this.isEnabled(item));
        drawEditButton(this, buttonRect, this.isEnabled(item));
        this.drawItemName(item, offsetX, rect.y, nameWidth);
        this.drawItemNumber(item, offsetX, rect.y, contentWidth);
        this.changePaintOpacity(1);
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

