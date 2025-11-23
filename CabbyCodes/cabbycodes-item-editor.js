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
            confirmWindow.select(0);
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
        const height = scene.calcWindowHeight(4, true);
        const x = Math.max(0, (Graphics.boxWidth - width) / 2);
        const y = Math.max(0, (Graphics.boxHeight - height) / 2 - 48);
        return new Rectangle(x, y, width, height);
    }

    function confirmWindowRect(scene) {
        const width = 360;
        const height = scene.calcWindowHeight(3, true);
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
    };

    Window_CabbyCodesItemEdit.prototype.setHandlers = function(handlers) {
        this._handlers = Object.assign({}, this._handlers, handlers);
    };

    Window_CabbyCodesItemEdit.prototype.prepare = function(item, currentQuantity, maxQuantity) {
        this._item = item;
        this._min = 1;
        this._max = Math.max(1, maxQuantity);
        this._quantity = clamp(currentQuantity, this._min, this._max);
        this.refresh();
    };

    Window_CabbyCodesItemEdit.prototype.maxItems = function() {
        return 3;
    };

    Window_CabbyCodesItemEdit.prototype.drawItem = function(index) {
        const rect = this.itemLineRect(index);
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
        const nameAreaWidth = Math.max(120, rect.width - 120);
        const quantityAreaWidth = Math.max(80, rect.width - nameAreaWidth);
        const textWidth = Math.max(60, nameAreaWidth - ImageManager.iconWidth - 8);
        if (this._item) {
            const iconY = rect.y + (rect.height - ImageManager.iconHeight) / 2;
            this.drawIcon(this._item.iconIndex, rect.x, iconY);
            this.drawText(this._item.name, rect.x + ImageManager.iconWidth + 8, rect.y, textWidth);
        } else {
            this.drawText('Item', rect.x, rect.y, nameAreaWidth);
        }
        const quantityText = `Qty: ${this._quantity}/${this._max} (<-/-> adjust)`;
        this.drawText(quantityText, rect.x + nameAreaWidth, rect.y, quantityAreaWidth, 'right');
    };

    Window_CabbyCodesItemEdit.prototype.processOk = function() {
        const index = this.index();
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
        if (newQuantity !== this._quantity) {
            this._quantity = newQuantity;
            SoundManager.playCursor();
            this.refresh();
        }
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
            { symbol: 'confirm', name: 'Remove Item' },
            { symbol: 'cancel', name: 'Keep Item' }
        ];
    };

    Window_CabbyCodesDeleteConfirm.prototype.setItem = function(item) {
        this._item = item;
        this.refresh();
    };

    Window_CabbyCodesDeleteConfirm.prototype.maxItems = function() {
        return this._commands.length;
    };

    Window_CabbyCodesDeleteConfirm.prototype.drawItem = function(index) {
        const rect = this.itemLineRect(index);
        const command = this._commands[index];
        if (!command) {
            return;
        }
        const label = index === 0 && this._item
            ? `Remove ${this._item.name}?`
            : command.name;
        drawCenteredButton(this, rect, label);
    };

    Window_CabbyCodesDeleteConfirm.prototype.processOk = function() {
        const command = this._commands[this.index()];
        if (!command) {
            Window_Selectable.prototype.processOk.call(this);
            return;
        }
        this.callHandler(command.symbol);
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

