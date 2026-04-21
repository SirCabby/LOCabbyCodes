//=============================================================================
// CabbyCodes Craft Checkboxes
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Craft Checkboxes - Shows completion checkmarks in the crafting station UI.
 * @author CabbyCodes
 * @help
 * Adds completion checkboxes to the crafting station's ingredient selection
 * menus. A first ingredient receives a check once every recipe pairing that
 * uses it has been discovered (restricted to recipes whose other ingredient
 * is currently in inventory). Each second ingredient shows a check when the
 * specific (first, second) pairing already matches a discovered recipe. The
 * "Nothing" option never renders a checkbox on either picker.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Craft Checkboxes requires the core module.');
        return;
    }

    const moduleApi = (CabbyCodes.craftCheckboxes = CabbyCodes.craftCheckboxes || {});

    // Recipes IDs and meta keys match the game's crafting data and
    // cabbycodes-recipe-book.js's viewer.
    const RECIPE_MIN_ID = 551;
    const RECIPE_MAX_ID = 600;
    const RECIPE_DISCOVERY_VAR_ID = 441;

    // The Recipe common event copies the WD_ItemUse return variable (70) into
    // this storage variable between the first and second pickers, so it holds
    // the already-chosen first ingredient while the second picker is open.
    const CRAFT_PRIMARY_STORAGE_VAR = 72;

    const WD_PLUGIN_NAME = 'WD_ItemUse';
    const WD_SCENE_CLASS_NAME = 'Scene_WdItems';
    const CRAFT_META_TAG = 'craft';
    const CRAFT_MAP_EVENT_REGEX = /craft/i;

    const DEBUG_LABEL = '[CabbyCodes][CraftCheckboxes]';
    const ENABLE_DEBUG_LOGS = false;

    const bookUi = CabbyCodes.bookUi || null;
    const DEFAULT_CHECKBOX_SIZE = Math.floor((bookUi?.defaults?.checkboxSize ?? 15) * (4 / 3));
    const DEFAULT_CHECKBOX_GAP = (bookUi?.defaults?.checkboxPadding ?? 4) * 2;

    let sharedRecipeCache = null;
    let wdDefaults = null;
    let wdHooksInitialized = false;
    let wdInitScheduled = false;
    let wdSceneHooked = false;
    let lastWdInvocation = null;
    let wdInvocationSerial = 0;

    function debugLog(...args) {
        if (!ENABLE_DEBUG_LOGS) {
            return;
        }
        CabbyCodes.log(`${DEBUG_LABEL} ${args.join(' ')}`);
    }

    initializeWdIntegration();

    function isCraftCallerEvent(name) {
        return typeof name === 'string' && CRAFT_MAP_EVENT_REGEX.test(name);
    }

    function currentStoredFirstIngredient() {
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return null;
        }
        const value = Number($gameVariables.value(CRAFT_PRIMARY_STORAGE_VAR));
        return value > 0 ? value : null;
    }

    function isNothingItem(item) {
        const meta = item && item.meta && item.meta.WD_Items;
        return typeof meta === 'string' && /\bnothing\b/i.test(meta);
    }

    function captureCurrentMapEventName() {
        if (typeof $gameMap === 'undefined' || !$gameMap) {
            return null;
        }
        const interpreter = $gameMap._interpreter;
        const eventId = interpreter && typeof interpreter.eventId === 'function'
            ? interpreter.eventId()
            : interpreter?._eventId;
        if (!eventId) {
            return null;
        }
        const gameEvent = typeof $gameMap.event === 'function' ? $gameMap.event(eventId) : null;
        const data = gameEvent && typeof gameEvent.event === 'function' ? gameEvent.event() : null;
        return data?.name || null;
    }

    function checkRecipe(recipeId) {
        if (typeof window.chkRecipe === 'function') {
            try {
                return !!window.chkRecipe(recipeId);
            } catch (e) {
                CabbyCodes.warn(`[CabbyCodes] Error checking recipe ${recipeId}:`, e);
                return false;
            }
        }
        if (typeof $gameVariables !== 'undefined' && $gameVariables) {
            const recipeData = $gameVariables.value(RECIPE_DISCOVERY_VAR_ID);
            if (Array.isArray(recipeData)) {
                const index = recipeId - RECIPE_MIN_ID;
                return !!recipeData[index];
            }
        }
        return false;
    }

    function buildRecipeCache() {
        if (typeof $dataItems === 'undefined' || !$dataItems) {
            return null;
        }
        const ingredientIndex = new Map();   // ingredientId -> Array<{ recipeId, otherId }>
        const comboMap = new Map();          // "a-b" (a<=b) -> { recipeId, discovered }
        for (let id = RECIPE_MIN_ID; id <= RECIPE_MAX_ID; id++) {
            const item = $dataItems[id];
            if (!item || !item.meta) {
                continue;
            }
            const ing1 = Number(item.meta.ing1);
            const ing2 = Number(item.meta.ing2);
            if (!Number.isFinite(ing1) || ing1 <= 0 || !Number.isFinite(ing2) || ing2 <= 0) {
                continue;
            }
            const discovered = checkRecipe(id);
            const entry = { recipeId: id, discovered };
            addIngredientLink(ingredientIndex, ing1, ing2, entry);
            if (ing1 !== ing2) {
                addIngredientLink(ingredientIndex, ing2, ing1, entry);
            }
            comboMap.set(buildComboKey(ing1, ing2), entry);
        }
        return { ingredientIndex, comboMap };
    }

    function addIngredientLink(index, ingredientId, otherId, entry) {
        let list = index.get(ingredientId);
        if (!list) {
            list = [];
            index.set(ingredientId, list);
        }
        list.push({ recipeId: entry.recipeId, otherId, entry });
    }

    function buildComboKey(a, b) {
        const low = Math.min(a, b);
        const high = Math.max(a, b);
        return `${low}-${high}`;
    }

    function getRecipeCache() {
        if (!sharedRecipeCache) {
            sharedRecipeCache = buildRecipeCache();
        }
        return sharedRecipeCache;
    }

    function invalidateCache() {
        sharedRecipeCache = null;
    }

    function otherInInventory(otherId) {
        if (typeof $gameParty === 'undefined' || typeof $dataItems === 'undefined' || !$dataItems) {
            return false;
        }
        const data = $dataItems[otherId];
        return !!data && $gameParty.numItems(data) > 0;
    }

    // Returns 'checked', 'unchecked', or 'invalid'. 'invalid' means the item
    // isn't referenced by any recipe so no combination will ever craft; the UI
    // draws a red dash for that case instead of a checkbox.
    function evaluatePrimaryCheckById(cache, itemId) {
        if (!cache || !itemId) {
            return 'unchecked';
        }
        const links = cache.ingredientIndex.get(Number(itemId));
        if (!links || links.length === 0) {
            return 'invalid';
        }
        let total = 0;
        let discovered = 0;
        for (const link of links) {
            const cookable = otherInInventory(link.otherId);
            if (!link.entry.discovered && !cookable) {
                continue;
            }
            total += 1;
            if (link.entry.discovered) {
                discovered += 1;
            }
        }
        if (total > 0 && discovered === total) {
            return 'checked';
        }
        return 'unchecked';
    }

    // Returns 'checked', 'unchecked', or 'invalid'. WD_ItemUse's per-primary
    // meta tag (e.g. "mxPALEFLUID") can surface items that share the tag but
    // don't actually pair with the chosen primary in any recipe, so a miss in
    // the comboMap is a real "will not combine" signal.
    function evaluateSecondaryCheckById(cache, firstId, secondId) {
        if (!cache || !firstId || !secondId) {
            return 'unchecked';
        }
        const combo = cache.comboMap.get(buildComboKey(firstId, secondId));
        if (!combo) {
            return 'invalid';
        }
        return combo.discovered ? 'checked' : 'unchecked';
    }

    function drawCheckbox(target, x, y, size, checked) {
        if (bookUi && typeof bookUi.drawCheckbox === 'function') {
            bookUi.drawCheckbox(target, x, y, checked, { size });
            return;
        }
        if (!target || !target.contents) {
            return;
        }
        const color = checked ? '#68ffd1' : 'rgba(255, 255, 255, 0.35)';
        const borderColor = '#ffffff';
        target.contents.fillRect(x, y, size, size, color);
        target.contents.fillRect(x, y, size, 1, borderColor);
        target.contents.fillRect(x, y, 1, size, borderColor);
        target.contents.fillRect(x + size - 1, y, 1, size, borderColor);
        target.contents.fillRect(x, y + size - 1, size, 1, borderColor);
    }

    function drawInvalidDash(target, x, y, size) {
        if (!target || !target.contents) {
            return;
        }
        const dashColor = '#ff5a5a';
        const thickness = Math.max(2, Math.floor(size / 5));
        const inset = Math.max(2, Math.floor(size / 6));
        const dashWidth = Math.max(1, size - inset * 2);
        const dashX = x + inset;
        const dashY = y + Math.floor((size - thickness) / 2);
        target.contents.fillRect(dashX, dashY, dashWidth, thickness, dashColor);
    }

    // -- WD_ItemUse integration ----------------------------------------------

    function initializeWdIntegration() {
        if (wdHooksInitialized) {
            return;
        }
        if (typeof PluginManager === 'undefined') {
            if (!wdInitScheduled) {
                wdInitScheduled = true;
                setTimeout(() => {
                    wdInitScheduled = false;
                    initializeWdIntegration();
                }, 250);
            }
            return;
        }
        wdHooksInitialized = true;
        wdDefaults = resolveWdDefaults();
        if (!wdDefaults) {
            debugLog('WD_ItemUse parameters unavailable; skipping integration.');
            return;
        }
        CabbyCodes.after(PluginManager, 'callCommand', function(self, pluginName, commandName, args) {
            if (pluginName === WD_PLUGIN_NAME && commandName === 'callItems') {
                lastWdInvocation = resolveWdInvocation(args);
                if (lastWdInvocation) {
                    lastWdInvocation.mapEventName = captureCurrentMapEventName();
                    debugLog(
                        'Captured WD invocation',
                        `idVar=${lastWdInvocation.returnInfo?.idVar || 0}`,
                        `metaTagVar=${lastWdInvocation.selector?.metaTagVarId || 0}`,
                        `meta=${lastWdInvocation.selector?.metaValue ?? 'null'}`,
                        `event=${lastWdInvocation.mapEventName ?? '<none>'}`
                    );
                }
            }
        });
        monitorWdScene();
    }

    function monitorWdScene() {
        if (wdSceneHooked) {
            return;
        }
        if (typeof SceneManager !== 'undefined' && SceneManager[WD_SCENE_CLASS_NAME]) {
            const proto = SceneManager[WD_SCENE_CLASS_NAME].prototype;
            if (proto && !proto._cabbycodesCraftWdDecorated) {
                CabbyCodes.after(proto, 'createWdItemWindow', function() {
                    decorateWdWindow(this._wdItemWindow);
                });
                proto._cabbycodesCraftWdDecorated = true;
                wdSceneHooked = true;
                debugLog('Hooked WD item window creation');
                return;
            }
        }
        setTimeout(monitorWdScene, 500);
    }

    function resolveWdDefaults() {
        const params = PluginManager.parameters?.(WD_PLUGIN_NAME);
        if (!params) {
            return null;
        }
        const baseSelector = parseWdSelector(params.itemSelector, true) || {
            selectorMode: 'mode1',
            includeEquip: false,
            metaTag: '0'
        };
        const defaultShowDesc = params.showDesc !== 'false';
        const baseReturn = parseWdReturnOptions(params.returnMode) || {
            returnMode: 'mode1',
            idVar: 0,
            catVar: 0,
            resultSwitch: 0
        };
        return {
            selector: baseSelector,
            showDesc: defaultShowDesc,
            returnInfo: baseReturn
        };
    }

    function parseWdSelector(raw, fromParam = false) {
        if (!raw || typeof raw !== 'string') {
            return null;
        }
        try {
            const parsed = JSON.parse(raw);
            if (fromParam) {
                parsed.includeEquip = parsed.includeEquip === 'true';
            }
            return parsed;
        } catch (error) {
            debugLog('Failed to parse WD selector:', error);
            return null;
        }
    }

    function parseWdReturnOptions(raw) {
        if (!raw || typeof raw !== 'string') {
            return null;
        }
        try {
            const parsed = JSON.parse(raw);
            return {
                returnMode: parsed.returnMode || 'mode1',
                idVar: Number(parsed.idVar || 0),
                catVar: Number(parsed.catVar || 0),
                resultSwitch: Number(parsed.resultSwitch || 0)
            };
        } catch (error) {
            debugLog('Failed to parse WD return options:', error);
            return null;
        }
    }

    function resolveWdInvocation(args = {}) {
        if (!wdDefaults) {
            return null;
        }
        const resolvedSelector = Object.assign({}, wdDefaults.selector);
        const selectorOverride = parseWdSelector(args.itemSelector);
        if (selectorOverride) {
            resolvedSelector.selectorMode =
                selectorOverride.selectorMode === 'mode0'
                    ? wdDefaults.selector.selectorMode
                    : selectorOverride.selectorMode || resolvedSelector.selectorMode;
            if (selectorOverride.includeEquip === 'mode1') {
                resolvedSelector.includeEquip = wdDefaults.selector.includeEquip;
            } else if (selectorOverride.includeEquip === 'mode2') {
                resolvedSelector.includeEquip = false;
            } else if (selectorOverride.includeEquip === 'mode3') {
                resolvedSelector.includeEquip = true;
            } else if (typeof selectorOverride.includeEquip === 'boolean') {
                resolvedSelector.includeEquip = selectorOverride.includeEquip;
            }
            if (selectorOverride.metaTag === '') {
                resolvedSelector.metaTag = wdDefaults.selector.metaTag;
            } else if (typeof selectorOverride.metaTag === 'string') {
                resolvedSelector.metaTag = selectorOverride.metaTag;
            }
        }
        resolvedSelector.metaTagVarId = Number(resolvedSelector.metaTag || 0) || 0;
        resolvedSelector.metaValue =
            resolvedSelector.metaTagVarId && typeof $gameVariables !== 'undefined'
                ? String($gameVariables.value(resolvedSelector.metaTagVarId) ?? '')
                : '';
        resolvedSelector.metaPrevValue =
            resolvedSelector.metaTagVarId > 0 && typeof $gameVariables !== 'undefined'
                ? String($gameVariables.value(resolvedSelector.metaTagVarId - 1) ?? '')
                : '';

        const showDescOverride = args.showDesc || 'mode1';
        const resolvedShowDesc =
            showDescOverride === 'mode2'
                ? true
                : showDescOverride === 'mode3'
                ? false
                : wdDefaults.showDesc;

        const returnOverride = parseWdReturnOptions(args.returnMode) || {};
        const resolvedReturn = Object.assign({}, wdDefaults.returnInfo);
        if (returnOverride.returnMode === 'mode1' || returnOverride.returnMode === 'mode2') {
            resolvedReturn.returnMode = returnOverride.returnMode;
        }
        if (returnOverride.idVar) {
            resolvedReturn.idVar = returnOverride.idVar;
        }
        if (returnOverride.catVar) {
            resolvedReturn.catVar = returnOverride.catVar;
        }
        if (returnOverride.resultSwitch) {
            resolvedReturn.resultSwitch = returnOverride.resultSwitch;
        }

        return {
            selector: resolvedSelector,
            showDesc: resolvedShowDesc,
            returnInfo: resolvedReturn,
            timestamp: Date.now(),
            invocationId: ++wdInvocationSerial
        };
    }

    function decorateWdWindow(windowInstance) {
        if (!windowInstance || windowInstance._cabbycodesCraftWdDecorated) {
            return;
        }
        const context = buildWdWindowContext();
        if (!context) {
            return;
        }
        windowInstance._cabbycodesCraftWdDecorated = true;
        windowInstance._cabbycodesCraftWdContext = context;
        windowInstance._cabbycodesCraftWdList = buildWdItemList(context.selector);

        const originalRefresh = windowInstance.refresh;
        windowInstance.refresh = function() {
            invalidateCache();
            this._cabbycodesCraftWdList = buildWdItemList(context.selector);
            return originalRefresh.apply(this, arguments);
        };

        const originalDrawItem = windowInstance.drawItem;
        windowInstance._cabbycodesCraftWdOriginalDrawItem = originalDrawItem;
        windowInstance.drawItem = function(index) {
            if (!this._cabbycodesCraftWdContext) {
                if (typeof originalDrawItem === 'function') {
                    return originalDrawItem.call(this, index);
                }
                return;
            }
            drawWdWindowRow(this, index);
        };
        debugLog('Decorated WD window', `mode=${context.mode}`, `items=${windowInstance._cabbycodesCraftWdList.length}`);
        lastWdInvocation = null;
        windowInstance.refresh();
    }

    function buildWdWindowContext() {
        if (!lastWdInvocation) {
            return null;
        }
        const mode = determineWdContextMode(lastWdInvocation.selector);
        if (!mode) {
            return null;
        }
        return {
            mode,
            selector: lastWdInvocation.selector,
            invocationId: lastWdInvocation.invocationId
        };
    }

    function determineWdContextMode(selector) {
        if (!selector) {
            return null;
        }
        if (!isCraftCallerEvent(lastWdInvocation?.mapEventName)) {
            return null;
        }
        const normalizedMeta = String(selector.metaValue || '').trim().toLowerCase();
        if (!normalizedMeta) {
            return null;
        }
        // The first picker uses the static "craft" meta tag; the second picker
        // uses a primary-scoped tag like "mxPALEFLUID" that narrows to valid
        // pairings, so any non-"craft" meta fired from the Crafting Table is
        // the second picker.
        return normalizedMeta === CRAFT_META_TAG ? 'primary' : 'secondary';
    }

    function drawWdWindowRow(windowInstance, index) {
        if (!windowInstance || !windowInstance._cabbycodesCraftWdContext) {
            return;
        }
        const list = windowInstance._cabbycodesCraftWdList;
        if (!list || index < 0 || index >= list.length) {
            return;
        }
        const itemData = list[index];
        const rect = windowInstance.itemLineRect(index);
        const checkboxSize = Math.max(12, Math.min(DEFAULT_CHECKBOX_SIZE, rect.height - 4));
        const checkboxX = rect.x;
        const checkboxY = rect.y + Math.floor((rect.height - checkboxSize) / 2);
        const iconX = rect.x + checkboxSize + DEFAULT_CHECKBOX_GAP;
        const iconY = rect.y + 4;
        const textX = iconX + 40;
        const textWidth = Math.max(0, rect.width - (textX - rect.x));

        windowInstance.contents.clearRect(rect.x, rect.y, rect.width, rect.height);

        const iconIndex = Number(itemData.iconIndex ?? itemData.data?.iconIndex ?? 0);
        if (Number.isFinite(iconIndex) && iconIndex >= 0) {
            windowInstance.drawIcon(iconIndex, iconX, iconY);
        }

        windowInstance.resetTextColor();
        windowInstance.changePaintOpacity(true);
        const label = formatWdItemLabel(itemData);
        const drawWidth = Math.max(0, textWidth - checkboxSize);
        windowInstance.drawTextEx(label, textX, rect.y, drawWidth);

        // Crafting omits the checkbox for the Nothing option on both pickers.
        const isNothing = !!itemData?.isNothing || isNothingItem(itemData?.data);
        if (isNothing) {
            return;
        }
        const context = windowInstance._cabbycodesCraftWdContext;
        const state = resolveWdCheckboxState(context, itemData);
        if (state === 'invalid') {
            drawInvalidDash(windowInstance, checkboxX, checkboxY, checkboxSize);
        } else {
            drawCheckbox(windowInstance, checkboxX, checkboxY, checkboxSize, state === 'checked');
        }
    }

    function resolveWdCheckboxState(context, itemData) {
        if (!context) {
            return 'unchecked';
        }
        const cache = getRecipeCache();
        if (!cache) {
            return 'unchecked';
        }
        const id = Number(itemData?.id || itemData?.data?.id || 0);
        if (!id) {
            return 'unchecked';
        }
        if (context.mode === 'primary') {
            return evaluatePrimaryCheckById(cache, id);
        }
        if (context.mode === 'secondary') {
            const firstId = currentStoredFirstIngredient();
            if (!firstId) {
                return 'unchecked';
            }
            return evaluateSecondaryCheckById(cache, firstId, id);
        }
        return 'unchecked';
    }

    function buildWdItemList(selector) {
        if (!selector) {
            return [];
        }
        switch (selector.selectorMode) {
            case 'mode1':
                return buildItemEntries();
            case 'mode2':
                return buildWeaponEntries(selector.includeEquip);
            case 'mode3':
                return buildArmorEntries(selector.includeEquip);
            case 'mode4':
                return buildAllInventoryEntries(selector.includeEquip);
            case 'mode5':
                return buildMetaTagEntries(selector);
            default:
                return [];
        }
    }

    function buildItemEntries() {
        if (typeof $gameParty === 'undefined') {
            return [];
        }
        const entries = ($gameParty.items() || []).map(item => createEntryFromData(item, 'Item'));
        return entries.sort(compareEntryNames);
    }

    function buildWeaponEntries(includeEquip = false) {
        if (typeof $gameParty === 'undefined') {
            return [];
        }
        const entries = [];
        for (const weapon of $gameParty.weapons() || []) {
            entries.push(createEntryFromData(weapon, 'Weapon'));
        }
        if (includeEquip) {
            appendEquippedItems(entries, 'Weapon');
        }
        return entries.sort(compareEntryNames);
    }

    function buildArmorEntries(includeEquip = false) {
        if (typeof $gameParty === 'undefined') {
            return [];
        }
        const entries = [];
        for (const armor of $gameParty.armors() || []) {
            entries.push(createEntryFromData(armor, 'Armor'));
        }
        if (includeEquip) {
            appendEquippedItems(entries, 'Armor');
        }
        return entries.sort(compareEntryNames);
    }

    function buildAllInventoryEntries(includeEquip = false) {
        if (typeof $gameParty === 'undefined') {
            return [];
        }
        const entries = [];
        const allItems = $gameParty.allItems() || [];
        for (const entry of allItems) {
            entries.push(createEntryFromData(entry, detectCategory(entry)));
        }
        if (includeEquip) {
            appendEquippedItems(entries, 'All');
        }
        return entries.sort(compareEntryNames);
    }

    function buildMetaTagEntries(selector) {
        if (typeof $gameParty === 'undefined') {
            return [];
        }
        const metaValue = selector.metaValue;
        const prevValue = selector.metaPrevValue;
        const entries = [];
        for (const item of $gameParty.items() || []) {
            if (matchesMetaTag(item, metaValue, prevValue)) {
                entries.push(createEntryFromData(item, 'Item'));
            }
        }
        for (const weapon of $gameParty.weapons() || []) {
            if (matchesMetaTag(weapon, metaValue, prevValue)) {
                entries.push(createEntryFromData(weapon, 'Weapon'));
            }
        }
        for (const armor of $gameParty.armors() || []) {
            if (matchesMetaTag(armor, metaValue, prevValue)) {
                entries.push(createEntryFromData(armor, 'Armor'));
            }
        }
        if (selector.includeEquip) {
            appendEquippedItems(entries, 'Meta', metaValue, prevValue);
        }
        return entries;
    }

    function matchesMetaTag(entry, valueA, valueB) {
        if (!entry || !entry.meta || !entry.meta.WD_Items) {
            return false;
        }
        const tag = String(entry.meta.WD_Items);
        return (valueA && tag.includes(valueA)) || (valueB && tag.includes(valueB));
    }

    function appendEquippedItems(entries, mode, valueA = '', valueB = '') {
        if (typeof $gameParty === 'undefined') {
            return;
        }
        const members = $gameParty.members ? $gameParty.members() : [];
        for (const actor of members) {
            const equips = actor?.equips() || [];
            for (const equip of equips) {
                if (!equip) {
                    continue;
                }
                if (mode === 'Meta' && !matchesMetaTag(equip, valueA, valueB)) {
                    continue;
                }
                if (mode === 'Weapon' && !DataManager.isWeapon?.(equip)) {
                    continue;
                }
                if (mode === 'Armor' && !DataManager.isArmor?.(equip)) {
                    continue;
                }
                if (mode === 'All' && !(DataManager.isWeapon?.(equip) || DataManager.isArmor?.(equip))) {
                    continue;
                }
                entries.push(createEntryFromData(equip, detectCategory(equip)));
            }
        }
    }

    function detectCategory(entry) {
        if (!entry) {
            return 'Item';
        }
        if (DataManager.isWeapon?.(entry)) {
            return 'Weapon';
        }
        if (DataManager.isArmor?.(entry)) {
            return 'Armor';
        }
        return 'Item';
    }

    function createEntryFromData(data, category) {
        if (!data) {
            return {
                id: 0,
                name: 'Nothing',
                iconIndex: 0,
                quantity: 0,
                category,
                isNothing: true
            };
        }
        const id = data.id || 0;
        return {
            id,
            name: data.name || 'Unknown',
            iconIndex: data.iconIndex || 0,
            quantity: resolveQuantityForCategory(category, id),
            category,
            data
        };
    }

    function resolveQuantityForCategory(category, id) {
        if (typeof $gameParty === 'undefined') {
            return 0;
        }
        if (category === 'Weapon') {
            return $gameParty.numItems($dataWeapons?.[id] || null);
        }
        if (category === 'Armor') {
            return $gameParty.numItems($dataArmors?.[id] || null);
        }
        return $gameParty.numItems($dataItems?.[id] || null);
    }

    function formatWdItemLabel(entry) {
        const baseName = entry?.name || entry?.data?.name || 'Unknown';
        const qty = entry?.quantity ?? 0;
        if (qty && qty !== 1) {
            return `${baseName} (x${qty})`;
        }
        return baseName;
    }

    function compareEntryNames(a, b) {
        const nameA = (a?.name || '').toString();
        const nameB = (b?.name || '').toString();
        const result = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
        if (result !== 0) {
            return result;
        }
        return (a?.id || 0) - (b?.id || 0);
    }

    moduleApi.invalidateCache = invalidateCache;

    CabbyCodes.log('[CabbyCodes] Craft ingredient checkboxes loaded');
})();
