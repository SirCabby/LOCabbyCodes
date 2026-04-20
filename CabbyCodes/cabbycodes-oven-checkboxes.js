//=============================================================================
// CabbyCodes Oven Checkboxes
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Oven Checkboxes - Shows completion checkmarks in the oven UI.
 * @author CabbyCodes
 * @help
 * Adds a CabbyCodes option that overlays completion checkboxes onto the oven's
 * ingredient selection menus. Primary ingredients receive a check once every
 * pairing (including solo dishes) has been cooked, and each secondary option
 * shows a check when that specific combination has already been discovered.
 * The "Nothing" secondary option is always marked complete for clarity.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Oven Checkboxes requires the core module.');
        return;
    }

    if (typeof Window_EventItem === 'undefined') {
        console.warn('[CabbyCodes] Window_EventItem is unavailable; oven checkboxes disabled.');
        return;
    }

    const moduleApi = (CabbyCodes.ovenCheckboxes = CabbyCodes.ovenCheckboxes || {});

    const settingKey = 'ovenCheckboxes';
    const PRIMARY_VAR_ID = 74;
    const SECONDARY_VAR_ID = 75;
    const NOTHING_LABEL = 'Nothing';
    const WD_PLUGIN_NAME = 'WD_ItemUse';
    const WD_SCENE_CLASS_NAME = 'Scene_WdItems';
    const DEBUG_LABEL = '[CabbyCodes][OvenCheckboxes]';
    const ENABLE_DEBUG_LOGS = false;

    const bookUi = CabbyCodes.bookUi || null;
    const DEFAULT_CHECKBOX_SIZE = Math.floor((bookUi?.defaults?.checkboxSize ?? 15) * (4 / 3));
    const DEFAULT_CHECKBOX_GAP = (bookUi?.defaults?.checkboxPadding ?? 4) * 2;

    let sharedCombinationCache = null;
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
        const message = `${DEBUG_LABEL} ${args.join(' ')}`;
        if (CabbyCodes.debugLoggingEnabled) {
            CabbyCodes.log(message);
        } else {
            CabbyCodes.warn(message);
        }
    }

    initializeWdIntegration();
    ensureCookbookResetHook();
    debugLog('Oven checkbox module initialized');

    function cookbookApi() {
        return CabbyCodes.cookbook || null;
    }

    function hasCookbookSupport() {
        const api = cookbookApi();
        return !!(api && typeof api.getCombinationData === 'function');
    }

    function storeChoiceVariable(windowInstance) {
        if (
            typeof $gameMessage !== 'undefined' &&
            $gameMessage &&
            typeof $gameMessage.itemChoiceVariableId === 'function'
        ) {
            windowInstance._cabbycodesChoiceVarId = $gameMessage.itemChoiceVariableId();
        } else {
            windowInstance._cabbycodesChoiceVarId = null;
        }
    }

    function getChoiceVariableId(windowInstance) {
        if (!windowInstance) {
            return null;
        }
        if (typeof windowInstance._cabbycodesChoiceVarId === 'number') {
            return windowInstance._cabbycodesChoiceVarId;
        }
        storeChoiceVariable(windowInstance);
        return windowInstance._cabbycodesChoiceVarId;
    }

    function shouldDecorate(windowInstance) {
        if (!isFeatureEnabled() || !hasCookbookSupport()) {
            return false;
        }
        const varId = getChoiceVariableId(windowInstance);
        return varId === PRIMARY_VAR_ID || varId === SECONDARY_VAR_ID;
    }

    function normalizeSecondaryId(item) {
        if (!item || !item.id) {
            return null;
        }
        if (isNothingItem(item)) {
            return null;
        }
        const value = Number(item.id);
        return value > 0 ? value : null;
    }

    function isNothingItem(item) {
        const meta = item && item.meta && item.meta.WD_Items;
        return typeof meta === 'string' && /\bnothing\b/i.test(meta);
    }

    function getCurrentPrimarySelection() {
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return null;
        }
        const value = Number($gameVariables.value(PRIMARY_VAR_ID));
        return value > 0 ? value : null;
    }

    function buildCombinationKey(primaryId, secondaryId) {
        const normalizedPrimary = Number(primaryId) || 0;
        const normalizedSecondary =
            secondaryId === null || secondaryId === undefined ? 'solo' : Number(secondaryId);
        return `${normalizedPrimary}-${normalizedSecondary}`;
    }

    function buildCombinationCache() {
        const api = cookbookApi();
        if (!api) {
            return null;
        }
        let combinations = [];
        try {
            combinations = api.getCombinationData() || [];
        } catch (error) {
            console.warn('[CabbyCodes] Failed to read oven combinations:', error);
            return null;
        }

        const primarySummary = new Map();
        const comboMap = new Map();

        combinations.forEach(combo => {
            if (!combo || !combo.primaryId) {
                return;
            }
            const list =
                primarySummary.get(combo.primaryId) || { total: 0, discovered: 0, name: combo.primaryName };
            list.name = list.name || combo.primaryName;
            list.total += 1;
            if (combo.discovered) {
                list.discovered += 1;
            }
            primarySummary.set(combo.primaryId, list);

            comboMap.set(combo.combinationKey, combo);
        });

        return { primarySummary, comboMap };
    }

    function getCombinationCache(windowInstance) {
        if (windowInstance) {
            if (!windowInstance._cabbycodesOvenCache) {
                windowInstance._cabbycodesOvenCache = buildCombinationCache();
            }
            return windowInstance._cabbycodesOvenCache;
        }
        if (!sharedCombinationCache) {
            sharedCombinationCache = buildCombinationCache();
        }
        return sharedCombinationCache;
    }

    function evaluatePrimaryCheck(windowInstance, item) {
        const cache = getCombinationCache(windowInstance);
        return evaluatePrimaryCheckById(cache, item?.id);
    }

    function evaluatePrimaryCheckById(cache, itemId) {
        if (!cache || !itemId) {
            return false;
        }
        let total = 0;
        let discovered = 0;
        cache.comboMap.forEach(combo => {
            if (combo.primaryId !== itemId) {
                return;
            }
            const cookable = !combo.secondaryId || secondaryInInventory(combo.secondaryId);
            if (!combo.discovered && !cookable) {
                return;
            }
            total += 1;
            if (combo.discovered) {
                discovered += 1;
            }
        });
        return total > 0 && discovered === total;
    }

    function secondaryInInventory(secondaryId) {
        if (typeof $gameParty === 'undefined' || typeof $dataItems === 'undefined' || !$dataItems) {
            return false;
        }
        const data = $dataItems[secondaryId];
        return !!data && $gameParty.numItems(data) > 0;
    }

    function evaluateSecondaryCheck(windowInstance, item) {
        const cache = getCombinationCache(windowInstance);
        return evaluateSecondaryCheckById(cache, normalizeSecondaryId(item));
    }

    function evaluateSecondaryCheckById(cache, normalizedSecondaryId) {
        if (normalizedSecondaryId === null) {
            const primaryId = getCurrentPrimarySelection();
            if (!primaryId || !cache) {
                return false;
            }
            const soloCombo = cache.comboMap.get(buildCombinationKey(primaryId, null));
            return !soloCombo || !!soloCombo.discovered;
        }
        const primaryId = getCurrentPrimarySelection();
        if (!primaryId || !cache) {
            return false;
        }
        const combo = cache.comboMap.get(buildCombinationKey(primaryId, normalizedSecondaryId));
        return !!(combo && combo.discovered);
    }

    function resolveCheckboxState(windowInstance, item) {
        const varId = getChoiceVariableId(windowInstance);
        if (varId === PRIMARY_VAR_ID) {
            return evaluatePrimaryCheck(windowInstance, item);
        }
        if (varId === SECONDARY_VAR_ID) {
            return evaluateSecondaryCheck(windowInstance, item);
        }
        return false;
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

    function drawItemText(windowInstance, item, rect, textOffset) {
        const textX = rect.x + textOffset;
        const numberWidth = windowInstance.numberWidth();
        const usableWidth = Math.max(0, rect.width - textOffset - numberWidth);

        windowInstance.changePaintOpacity(windowInstance.isEnabled(item));
        if (item) {
            windowInstance.drawItemName(item, textX, rect.y, usableWidth);
            windowInstance.drawItemNumber(item, textX, rect.y, rect.width - textOffset);
        } else {
            windowInstance.drawText(NOTHING_LABEL, textX, rect.y, usableWidth, 'left');
        }
        windowInstance.changePaintOpacity(1);
    }

    function ensureCookbookResetHook() {
        if (!CabbyCodes.cookbook) {
            setTimeout(ensureCookbookResetHook, 250);
            return;
        }
        if (CabbyCodes.cookbook._cabbycodesOvenResetHook) {
            return;
        }
        const originalReset = CabbyCodes.cookbook.resetCombinationCache;
        CabbyCodes.cookbook.resetCombinationCache = function() {
            sharedCombinationCache = null;
            if (typeof originalReset === 'function') {
                return originalReset.apply(this, arguments);
            }
            return undefined;
        };
        CabbyCodes.cookbook._cabbycodesOvenResetHook = true;
    }

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
                    debugLog(
                        'Captured WD invocation',
                        `idVar=${lastWdInvocation.returnInfo?.idVar || 0}`,
                        `metaTagVar=${lastWdInvocation.selector?.metaTagVarId || 0}`,
                        `meta=${lastWdInvocation.selector?.metaValue ?? 'null'}`
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
            if (proto && !proto._cabbycodesWdDecorated) {
                CabbyCodes.after(proto, 'createWdItemWindow', function() {
                    decorateWdWindow(this._wdItemWindow);
                });
                proto._cabbycodesWdDecorated = true;
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
        if (!windowInstance || windowInstance._cabbycodesWdDecorated) {
            return;
        }
        const context = buildWdWindowContext();
        if (!context) {
            const fallbackMeta = lastWdInvocation?.selector?.metaValue || '<none>';
            debugLog('WD window opened without oven context', `meta=${fallbackMeta}`);
            return;
        }
        windowInstance._cabbycodesWdDecorated = true;
        windowInstance._cabbycodesWdContext = context;
        windowInstance._cabbycodesWdList = buildWdItemList(context.selector, context.mode);

        const originalRefresh = windowInstance.refresh;
        windowInstance.refresh = function() {
            sharedCombinationCache = null;
            this._cabbycodesWdList = buildWdItemList(context.selector, this._cabbycodesWdContext.mode);
            return originalRefresh.apply(this, arguments);
        };

        const originalDrawItem = windowInstance.drawItem;
        windowInstance._cabbycodesWdOriginalDrawItem = originalDrawItem;
        windowInstance.drawItem = function(index) {
            if (!this._cabbycodesWdContext) {
                debugLog('WD drawItem without context', `index=${index}`);
                if (typeof originalDrawItem === 'function') {
                    return originalDrawItem.call(this, index);
                }
                return;
            }
            drawWdWindowRow(this, index);
        };
        debugLog('Decorated WD window', `mode=${context.mode}`, `items=${windowInstance._cabbycodesWdList.length}`);
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
        const normalizedMeta = String(selector.metaValue || '').trim().toLowerCase();
        if (!normalizedMeta) {
            return null;
        }
        if (normalizedMeta === 'cook') {
            return 'primary';
        }
        if (normalizedMeta.startsWith('ck')) {
            return 'secondary';
        }
        return null;
    }

    function drawWdWindowRow(windowInstance, index) {
        if (!windowInstance || !windowInstance._cabbycodesWdContext) {
            return;
        }
        const list = windowInstance._cabbycodesWdList;
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

        const context = windowInstance._cabbycodesWdContext;
        const skipCheckbox = context.mode === 'primary' && isNothingItem(itemData?.data);
        let checked = null;
        if (!skipCheckbox) {
            checked = resolveWdCheckboxState(context, itemData);
            drawCheckbox(windowInstance, checkboxX, checkboxY, checkboxSize, checked);
        }
        debugLog(
            'Drawing WD row',
            `mode=${context.mode}`,
            `index=${index}`,
            `checked=${skipCheckbox ? 'skipped' : checked}`,
            `label=${label}`
        );
    }

    function resolveWdCheckboxState(context, itemData) {
        if (!context) {
            return false;
        }
        const cache = getCombinationCache();
        if (context.mode === 'primary') {
            return evaluatePrimaryCheckById(cache, itemData?.id);
        }
        if (context.mode === 'secondary') {
            const source = itemData?.isNothing
                ? null
                : (itemData?.data || (itemData?.id ? { id: itemData.id } : null));
            const normalized = normalizeSecondaryId(source);
            return evaluateSecondaryCheckById(cache, normalized);
        }
        return false;
    }

    function buildWdItemList(selector, mode) {
        if (!selector) {
            return [];
        }
        switch (selector.selectorMode) {
            case 'mode1':
                return buildItemEntries(mode);
            case 'mode2':
                return buildWeaponEntries(selector.includeEquip, mode);
            case 'mode3':
                return buildArmorEntries(selector.includeEquip, mode);
            case 'mode4':
                return buildAllInventoryEntries(selector.includeEquip, mode);
            case 'mode5':
                return buildMetaTagEntries(selector, mode);
            default:
                return [];
        }
    }

    function buildItemEntries(mode) {
        if (typeof $gameParty === 'undefined') {
            return [];
        }
        const items = $gameParty.items() || [];
        const entries = items.map(item => createEntryFromData(item, 'Item'));
        if (mode === 'primary') {
            ensureAllPrimaries(entries);
        }
        return entries.sort(compareEntryNames);
    }

    function buildWeaponEntries(includeEquip = false, mode) {
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
        if (mode === 'primary') {
            ensureAllPrimaries(entries);
        }
        return entries.sort(compareEntryNames);
    }

    function buildArmorEntries(includeEquip = false, mode) {
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
        if (mode === 'primary') {
            ensureAllPrimaries(entries);
        }
        return entries.sort(compareEntryNames);
    }

    function buildAllInventoryEntries(includeEquip = false, mode) {
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
        if (mode === 'primary') {
            ensureAllPrimaries(entries);
        }
        return entries.sort(compareEntryNames);
    }

    function buildMetaTagEntries(selector, mode) {
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
        if (mode === 'primary') {
            ensureAllPrimaries(entries);
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
        const qty = entry?.quantity ?? entry?.itemQuantities ?? 0;
        if (qty && qty !== 1) {
            return `${baseName} (x${qty})`;
        }
        return baseName;
    }

    function ensureAllPrimaries(entries) {
        const cache = getCombinationCache();
        if (!cache || !cache.primarySummary) {
            return;
        }
        const existing = new Set(entries.map(entry => entry.id));
        cache.primarySummary.forEach((summary, primaryId) => {
            if (existing.has(primaryId)) {
                return;
            }
            const label =
                summary?.name ||
                safeItemName($dataItems?.[primaryId] || null, primaryId) ||
                `Item ${primaryId}`;
            entries.push({
                id: primaryId,
                name: label,
                iconIndex: 0,
                quantity: resolveQuantityForCategory('Item', primaryId),
                category: 'Item',
                data: $dataItems?.[primaryId] || null,
                placeholder: true
            });
            existing.add(primaryId);
        });
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

    CabbyCodes.after(Window_EventItem.prototype, 'start', function() {
        storeChoiceVariable(this);
    });

    CabbyCodes.before(Window_EventItem.prototype, 'refresh', function() {
        this._cabbycodesOvenCache = null;
    });

    CabbyCodes.override(Window_EventItem.prototype, 'drawItem', function(index) {
        if (!shouldDecorate(this)) {
            return CabbyCodes.callOriginal(Window_EventItem.prototype, 'drawItem', this, [index]);
        }

        const cache = getCombinationCache(this);
        if (!cache) {
            return CabbyCodes.callOriginal(Window_EventItem.prototype, 'drawItem', this, [index]);
        }

        const item = this.itemAt(index);
        const rect = this.itemLineRect(index);
        const checkboxSize = Math.max(12, Math.min(DEFAULT_CHECKBOX_SIZE, rect.height - 4));
        const textOffset = checkboxSize + DEFAULT_CHECKBOX_GAP;
        const checkboxX = rect.x;
        const checkboxY = rect.y + Math.floor((rect.height - checkboxSize) / 2);

        drawItemText(this, item, rect, textOffset);

        const checked = resolveCheckboxState(this, item);
        drawCheckbox(this, checkboxX, checkboxY, checkboxSize, checked);
    });

    CabbyCodes.log('[CabbyCodes] Oven ingredient checkboxes loaded');
})();


