//=============================================================================
// CabbyCodes Item Giver
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Item Giver - Give any item from the game database
 * @author CabbyCodes
 * @help
 * Allows players to open a filtered item selection window to add any item
 * from the game database to their inventory. Accessible from the Options menu.
 */

(() => {
    'use strict';

    // Ensure CabbyCodes namespace exists
    if (typeof window.CabbyCodes === 'undefined') {
        window.CabbyCodes = {};
    }

    const itemGiverDebugLog = function(...args) {
        if (typeof CabbyCodes.debug === 'function') {
            CabbyCodes.debug(...args);
        }
    };

    function getNormalColor(instance) {
        if (typeof ColorManager !== 'undefined' && typeof ColorManager.normalColor === 'function') {
            return ColorManager.normalColor();
        }
        if (instance && typeof instance.textColor === 'function') {
            return instance.textColor(0);
        }
        return '#ffffff';
    }

    function getGaugeBackColor() {
        if (typeof ColorManager !== 'undefined' && typeof ColorManager.gaugeBackColor === 'function') {
            return ColorManager.gaugeBackColor();
        }
        return '#202020';
    }

    const HEADER_MARKER_CHARS = new Set([
        '-', '‐', '‑', '‒', '–', '—', '―',
        '_', '=', '~', '*', '#', '+', '•', '·',
        '<', '>', '[', ']', '{', '}', '(', ')',
        '|', ':', ';', '.', ',', '!', '?', '/',
        '\\', '\'', '"', '`'
    ]);

    const HEADER_MARKER_WHITESPACE = new Set([' ', '\t']);

    function isHeaderBoundaryChar(char) {
        return HEADER_MARKER_CHARS.has(char) || HEADER_MARKER_WHITESPACE.has(char);
    }

    function stripHeaderMarkers(text) {
        if (!text) {
            return null;
        }

        let start = 0;
        let prefixMarkerCount = 0;
        while (start < text.length && isHeaderBoundaryChar(text[start])) {
            if (HEADER_MARKER_CHARS.has(text[start])) {
                prefixMarkerCount++;
            }
            start++;
        }

        let end = text.length;
        let suffixMarkerCount = 0;
        while (end > start && isHeaderBoundaryChar(text[end - 1])) {
            if (HEADER_MARKER_CHARS.has(text[end - 1])) {
                suffixMarkerCount++;
            }
            end--;
        }

        if ((prefixMarkerCount >= 2 || suffixMarkerCount >= 2) && end > start) {
            const candidate = text.substring(start, end).trim();
            return candidate.length > 0 ? candidate : null;
        }

        return null;
    }

    const ITEM_GIVER_SECTION_DEFINITIONS = [
        {
            key: 'item',
            label: 'Items',
            dataAccessor: () => $dataItems,
            validator: (entry) => DataManager.isItem(entry)
        },
        {
            key: 'weapon',
            label: 'Weapons',
            dataAccessor: () => $dataWeapons,
            validator: (entry) => DataManager.isWeapon(entry)
        },
        {
            key: 'armor',
            label: 'Armors',
            dataAccessor: () => $dataArmors,
            validator: (entry) => DataManager.isArmor(entry)
        }
    ];

    const ITEM_GIVER_TYPE_VALIDATORS = ITEM_GIVER_SECTION_DEFINITIONS.reduce((acc, sectionDef) => {
        acc[sectionDef.key] = sectionDef.validator;
        return acc;
    }, {});

    const ITEM_GIVER_VALID_FILTERS = ITEM_GIVER_SECTION_DEFINITIONS.reduce((filters, sectionDef) => {
        filters.add(sectionDef.key);
        return filters;
    }, new Set(['all']));

    const ITEM_GIVER_AUTO_EXCLUDED_NAMES = new Set(['return to title screen']);
    const ITEM_GIVER_ALWAYS_INCLUDED_NAMES = new Set(['cowboy hat']);
    const RPG_COLOR_CODE_REGEX = /\\C\[\d+\]/gi;
    const BROKEN_WEAPON_NAME_REGEX = /\b(broken|cracked)\b/i;
    const NOT_OPTIMAL_NOTE_REGEX = /<notOptimal>/i;

    let itemGiverPersistedFilters = null;

    const ITEM_GIVER_UI_CONSTANTS = {
        selectorHorizontalPadding: 12,
        selectorHorizontalPaddingRight: 24,
        selectorVerticalGap: 6,
        searchHorizontalPadding: 12,
        searchVerticalGap: 12,
        dropdownPadding: 10,
        dropdownContentPadding: 0,
        dropdownTextHorizontalPadding: 14,
        dropdownLabelValueSpacing: 12,
        selectorCombinedWidthBonus: 20,
        searchPadding: 10,
        dropdownValueRightInset: 16
    };

    function sanitizeDatabaseName(name) {
        return typeof name === 'string' ? name.trim() : '';
    }

    function hasUsableName(entry) {
        return !!entry && sanitizeDatabaseName(entry.name).length > 0;
    }

    function normalizeCategory(categorySymbol) {
        return ITEM_GIVER_VALID_FILTERS.has(categorySymbol) ? categorySymbol : 'all';
    }

    const DATA_SECTION_HEADER_REGEX = /^[-‐‑‒–—―_=]{2,}\s*(.+?)\s*[-‐‑‒–—―_=]{2,}$/i;

    function extractDataSectionLabel(entry) {
        if (!entry) {
            return null;
        }
        const sanitizedName = sanitizeDatabaseName(entry.name || '');
        const match = sanitizedName.match(DATA_SECTION_HEADER_REGEX);
        if (match) {
            const label = match[1] ? match[1].trim() : '';
            if (label.length > 0) {
                return label;
            }
        }

        const stripped = stripHeaderMarkers(sanitizedName);
        if (stripped) {
            return stripped;
        }

        return null;
    }

    function isValidItemEntry(itemData) {
        if (!itemData || itemData.isSectionHeader) {
            return false;
        }
        if (!itemData.item || typeof itemData.type !== 'string') {
            return false;
        }
        // sourceType is the $data* array the entry was harvested from. It may differ from
        // `type` when a rule re-homes items across UI categories (e.g. ranged armors that
        // present as Weapons). Validation must always use the source, since DataManager's
        // isItem/isWeapon/isArmor checks the underlying database.
        const validatorKey = typeof itemData.sourceType === 'string' ? itemData.sourceType : itemData.type;
        const validator = ITEM_GIVER_TYPE_VALIDATORS[validatorKey];
        if (typeof validator !== 'function') {
            return false;
        }
        return validator(itemData.item) && hasUsableName(itemData.item);
    }

    // Subtype taxonomy: authoritative, first-match-wins rules per category. Replaces the old
    // name-header scanner whose lack of end-of-section boundaries let items leak across subtypes.
    const WD_ITEMS_TAG_REGEX = /<WD_Items:\s*([^>]+)>/i;

    function getWDItemsBody(item) {
        if (!item) {
            return null;
        }
        if (item.meta && typeof item.meta.WD_Items === 'string' && item.meta.WD_Items.trim().length > 0) {
            return item.meta.WD_Items.toLowerCase().trim();
        }
        if (typeof item.note === 'string' && item.note.length > 0) {
            const match = item.note.match(WD_ITEMS_TAG_REGEX);
            if (match && match[1]) {
                return match[1].toLowerCase().trim();
            }
        }
        return null;
    }

    function hasWDItemsTag(item, tagName) {
        const body = getWDItemsBody(item);
        if (!body || !tagName) {
            return false;
        }
        const target = String(tagName).toLowerCase();
        const tokens = body.split(/\s+/);
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i] === target) {
                return true;
            }
        }
        return false;
    }

    function hasAnyWDItemsTag(item) {
        return getWDItemsBody(item) !== null;
    }

    // itypeId===4 and the <WD_Items:gamemode> tag mark the hidden game-mode selector
    // entries the base game injects into $dataItems. They're internal plumbing, not
    // player-facing loot — never list them in the giver UI.
    function isGamemodeSelectorItem(item) {
        return !!item && (item.itypeId === 4 || hasWDItemsTag(item, 'gamemode'));
    }

    // The <WD_Items: nothing> tag marks the placeholder entry the oven/paintable
    // system uses to represent "no ingredient". Giving it to the player has no
    // effect and clutters the UI.
    function isInternalPlaceholderItem(item) {
        return !!item && hasWDItemsTag(item, 'nothing');
    }

    // Ranged-weapon armors ship with both loaded and "[Empty]" variants
    // (Pistol [Empty], SMG [Empty], etc.). The empty copies exist only so the
    // game can swap to them when ammo runs out — giving one to the player is
    // worse than giving nothing.
    const EMPTY_VARIANT_NAME_SUFFIX_REGEX = /\s*\[empty]\s*$/i;
    function isEmptyAmmoVariant(item) {
        if (!item || typeof item.name !== 'string') {
            return false;
        }
        return EMPTY_VARIANT_NAME_SUFFIX_REGEX.test(item.name);
    }

    const ITEM_GIVER_SUBTYPE_DEFINITIONS = [
        // Tag-driven rules run first: the game's <WD_Items:...> note is the most specific
        // signal and cross-cuts itypeId (e.g. `videogame` items use itypeId=3, `discObj`
        // uses itypeId=2). Relying on itypeId alone would bury these specific buckets.
        { key: 'item-medical',        label: 'Medical',          type: 'item',   match: (it) => it && hasWDItemsTag(it, 'medical') },
        { key: 'item-snack',          label: 'Snacks',           type: 'item',   match: (it) => it && hasWDItemsTag(it, 'snack') },
        { key: 'item-valuables',      label: 'Valuables',        type: 'item',   match: (it) => it && (hasWDItemsTag(it, 'valuables') || hasWDItemsTag(it, 'gift')) },
        { key: 'item-recipe',         label: 'Recipes',          type: 'item',   match: (it) => it && hasWDItemsTag(it, 'recipe') },
        { key: 'item-videogame',      label: 'Video Games',      type: 'item',   match: (it) => it && hasWDItemsTag(it, 'videogame') },
        { key: 'item-email',          label: 'Emails',           type: 'item',   match: (it) => it && hasWDItemsTag(it, 'email') },
        { key: 'item-disc',           label: 'Disc Objects',     type: 'item',   match: (it) => it && hasWDItemsTag(it, 'discobj') },
        { key: 'item-coin',           label: 'Coins',            type: 'item',   match: (it) => it && hasWDItemsTag(it, 'coin') },
        { key: 'item-craft',          label: 'Crafting',         type: 'item',   match: (it) => it && hasWDItemsTag(it, 'craft') },
        { key: 'item-cooking',        label: 'Cooking',          type: 'item',   match: (it) => it && hasWDItemsTag(it, 'cook') },
        { key: 'item-key',            label: 'Key Items',        type: 'item',   match: (it) => it && it.itypeId === 2 },
        { key: 'item-regular-tagged', label: 'Regular (Tagged)', type: 'item',   match: (it) => it && it.itypeId === 1 && hasAnyWDItemsTag(it) },
        { key: 'item-regular',        label: 'Regular',          type: 'item',   match: (it) => it && it.itypeId === 1 },
        { key: 'weapon-1',       label: 'Simple',            type: 'weapon', match: (it) => it && it.wtypeId === 1 },
        { key: 'weapon-2',       label: 'Bludgeon',          type: 'weapon', match: (it) => it && it.wtypeId === 2 },
        { key: 'weapon-3',       label: 'Slashing',          type: 'weapon', match: (it) => it && it.wtypeId === 3 },
        { key: 'weapon-4',       label: 'Piercing',          type: 'weapon', match: (it) => it && it.wtypeId === 4 },
        { key: 'weapon-5',       label: 'Two Handed Weapon', type: 'weapon', match: (it) => it && it.wtypeId === 5 },
        { key: 'weapon-0',       label: 'Uncategorized',     type: 'weapon', match: (it) => it && it.wtypeId === 0 },
        // etypeId=2 items live in $dataArmors for slot-equip purposes but are semantically
        // ranged weapons. `sourceType: 'armor'` keeps the underlying DataManager.isArmor check
        // valid; `uiType: 'weapon'` lists them under the Weapons category in the UI.
        { key: 'weapon-ranged',  label: 'Ranged Weapons',    type: 'armor',  uiType: 'weapon', match: (it) => it && it.etypeId === 2 },
        { key: 'armor-3',        label: 'Head',              type: 'armor',  match: (it) => it && it.etypeId === 3 },
        { key: 'armor-4',        label: 'Body',              type: 'armor',  match: (it) => it && it.etypeId === 4 },
        { key: 'armor-5',        label: 'Feet',              type: 'armor',  match: (it) => it && it.etypeId === 5 },
        { key: 'armor-6',        label: 'Accessory',         type: 'armor',  match: (it) => it && it.etypeId === 6 },
        { key: 'armor-7',        label: 'Jewelry',           type: 'armor',  match: (it) => it && it.etypeId === 7 }
    ];

    const ITEM_GIVER_SUBTYPE_FALLBACK = {
        item:   { key: 'item-other',   label: 'Other' },
        weapon: { key: 'weapon-other', label: 'Other' },
        armor:  { key: 'armor-other',  label: 'Other' }
    };

    const ITEM_GIVER_SUBTYPE_ORDER = (() => {
        const order = {};
        ITEM_GIVER_SUBTYPE_DEFINITIONS.forEach((def, index) => {
            order[def.key] = index;
        });
        const fallbackBase = ITEM_GIVER_SUBTYPE_DEFINITIONS.length;
        Object.values(ITEM_GIVER_SUBTYPE_FALLBACK).forEach((fb, i) => {
            order[fb.key] = fallbackBase + i;
        });
        return order;
    })();

    function resolveSubtype(entry, sourceCategoryKey) {
        for (let i = 0; i < ITEM_GIVER_SUBTYPE_DEFINITIONS.length; i++) {
            const def = ITEM_GIVER_SUBTYPE_DEFINITIONS[i];
            if (def.type !== sourceCategoryKey) {
                continue;
            }
            try {
                if (def.match(entry)) {
                    return {
                        key: def.key,
                        label: def.label,
                        uiType: def.uiType || def.type
                    };
                }
            } catch (_) {
                // fall through to fallback on unexpected matcher error
            }
        }
        const fb = ITEM_GIVER_SUBTYPE_FALLBACK[sourceCategoryKey] || { key: `${sourceCategoryKey}-other`, label: 'Other' };
        return { key: fb.key, label: fb.label, uiType: sourceCategoryKey };
    }

    function collectEntriesForSection(sectionDef, subsectionsByCategory) {
        const entries = [];
        const source = typeof sectionDef.dataAccessor === 'function' ? sectionDef.dataAccessor() : null;
        const subsectionSeen = subsectionsByCategory && subsectionsByCategory.__seen instanceof Set
            ? subsectionsByCategory.__seen
            : null;

        if (!Array.isArray(source)) {
            return entries;
        }

        // SAFEGUARD: This function only collects items for display. It NEVER adds items to inventory.
        const partyBefore = typeof $gameParty !== 'undefined' && $gameParty ?
            JSON.stringify($gameParty._items || {}) : null;

        for (let i = 0; i < source.length; i++) {
            const dbEntry = source[i];
            if (!dbEntry || !sectionDef.validator(dbEntry) || !hasUsableName(dbEntry)) {
                continue;
            }

            if (sectionDef.key === 'item' && isGamemodeSelectorItem(dbEntry)) {
                continue;
            }
            if (isInternalPlaceholderItem(dbEntry) || isEmptyAmmoVariant(dbEntry)) {
                continue;
            }

            // Drop in-data section-header rows (e.g. "== Swords ==" or names whose only payload
            // is bracketing punctuation). They used to seed subsections for every item that
            // followed them, which leaked items across subtypes. Classification is now driven
            // entirely by itypeId / wtypeId / etypeId / <WD_Items:...> metadata.
            if (extractDataSectionLabel(dbEntry)) {
                continue;
            }

            const subtype = resolveSubtype(dbEntry, sectionDef.key);

            entries.push({
                item: dbEntry,
                type: subtype.uiType,          // UI category (may differ from source for re-homed items)
                sourceType: sectionDef.key,    // $data* array the item actually lives in — used for validation
                id: dbEntry.id,
                name: sanitizeDatabaseName(dbEntry.name),
                subSectionKey: subtype.key,
                subSectionLabel: subtype.label,
                sourceIndex: i
            });

            const targetBucket = subsectionsByCategory && Array.isArray(subsectionsByCategory[subtype.uiType])
                ? subsectionsByCategory[subtype.uiType]
                : null;
            if (targetBucket && subsectionSeen && !subsectionSeen.has(subtype.key)) {
                subsectionSeen.add(subtype.key);
                targetBucket.push({
                    key: subtype.key,
                    label: subtype.label,
                    type: subtype.uiType
                });
            }
        }

        if (partyBefore && typeof $gameParty !== 'undefined' && $gameParty) {
            const partyAfter = JSON.stringify($gameParty._items || {});
            if (partyBefore !== partyAfter) {
                CabbyCodes.error('[CabbyCodes] Item Giver: CRITICAL BUG - Items were added during collection! This should never happen.');
                CabbyCodes.error('[CabbyCodes] Before: ' + partyBefore);
                CabbyCodes.error('[CabbyCodes] After: ' + partyAfter);
            }
        }

        return entries;
    }

    /**
     * Collects all valid items from the game database.
     * @returns {Array} Array of item objects with metadata
     */
    function collectAllItems() {
        const subsections = {};
        const byUiCategory = {};
        ITEM_GIVER_SECTION_DEFINITIONS.forEach((sectionDef) => {
            subsections[sectionDef.key] = [];
            byUiCategory[sectionDef.key] = [];
        });
        // Shared de-dup set so a subtype registered during one source pass isn't re-added
        // if the same key shows up again (e.g. cross-section re-homing).
        Object.defineProperty(subsections, '__seen', { value: new Set(), enumerable: false });

        // Harvest from each $data* source; entries may land in a UI category different from
        // their source (ranged-weapon armors are re-homed under Weapons).
        ITEM_GIVER_SECTION_DEFINITIONS.forEach((sectionDef) => {
            const sectionEntries = collectEntriesForSection(sectionDef, subsections);
            for (let i = 0; i < sectionEntries.length; i++) {
                const entry = sectionEntries[i];
                const bucket = byUiCategory[entry.type] || byUiCategory[sectionDef.key];
                bucket.push(entry);
            }
        });

        // Emit in UI-category order so section headers group their entries coherently.
        const orderedItems = [];
        ITEM_GIVER_SECTION_DEFINITIONS.forEach((sectionDef) => {
            const entries = byUiCategory[sectionDef.key];
            if (entries && entries.length > 0) {
                orderedItems.push({
                    isSectionHeader: true,
                    type: sectionDef.key,
                    name: sectionDef.label
                });
                orderedItems.push(...entries);
            }
        });

        // Sort each UI-category's dropdown list in declared taxonomy order.
        Object.keys(subsections).forEach((categoryKey) => {
            const list = subsections[categoryKey];
            if (Array.isArray(list)) {
                list.sort((a, b) => {
                    const ai = ITEM_GIVER_SUBTYPE_ORDER[a.key];
                    const bi = ITEM_GIVER_SUBTYPE_ORDER[b.key];
                    const av = typeof ai === 'number' ? ai : Number.MAX_SAFE_INTEGER;
                    const bv = typeof bi === 'number' ? bi : Number.MAX_SAFE_INTEGER;
                    return av - bv;
                });
            }
        });

        return {
            entries: orderedItems,
            subsections
        };
    }

    function normalizeNameForComparison(itemOrName) {
        const rawName = typeof itemOrName === 'string' ? itemOrName : itemOrName?.name;
        const sanitized = sanitizeDatabaseName(rawName || '');
        if (!sanitized) {
            return '';
        }
        const withoutCodes = sanitized.replace(RPG_COLOR_CODE_REGEX, '');
        return withoutCodes.trim().toLowerCase();
    }

    function shouldExcludeItemByName(item) {
        if (!item) {
            return false;
        }
        const normalized = normalizeNameForComparison(item);
        return normalized ? ITEM_GIVER_AUTO_EXCLUDED_NAMES.has(normalized) : false;
    }

    function isAlwaysIncludedName(item) {
        const normalized = normalizeNameForComparison(item);
        return normalized ? ITEM_GIVER_ALWAYS_INCLUDED_NAMES.has(normalized) : false;
    }

    function hasMetaFlag(item, flag) {
        if (!item || !item.meta || typeof item.meta !== 'object') {
            return false;
        }
        return Object.prototype.hasOwnProperty.call(item.meta, flag);
    }

    function isNotOptimalEntry(entry) {
        const item = entry?.item;
        if (!item) {
            return false;
        }
        if (hasMetaFlag(item, 'notOptimal')) {
            return true;
        }
        const note = typeof item.note === 'string' ? item.note : '';
        return note.length > 0 && NOT_OPTIMAL_NOTE_REGEX.test(note);
    }

    function isBrokenOrCrackedWeaponEntry(entry) {
        if (!entry || entry.type !== 'weapon') {
            return false;
        }
        const item = entry.item;
        if (!item) {
            return false;
        }
        if (
            hasMetaFlag(item, 'repairTo') ||
            hasMetaFlag(item, 'repairFrom') ||
            hasMetaFlag(item, 'brokenVariant')
        ) {
            return true;
        }
        const name = typeof item.name === 'string' ? item.name : '';
        if (name && BROKEN_WEAPON_NAME_REGEX.test(name)) {
            return true;
        }
        const note = typeof item.note === 'string' ? item.note : '';
        return note && BROKEN_WEAPON_NAME_REGEX.test(note);
    }

    function shouldSkipCatalogEntry(entry) {
        if (!entry || !entry.item) {
            return true;
        }

        if (isAlwaysIncludedName(entry.item)) {
            // Keep explicitly included entries unless they are marked as not optimal variants.
            return isNotOptimalEntry(entry);
        }

        if (shouldExcludeItemByName(entry.item)) {
            return true;
        }

        if (isNotOptimalEntry(entry)) {
            return true;
        }

        if (isBrokenOrCrackedWeaponEntry(entry)) {
            return true;
        }

        return false;
    }

    function getOwnedItemCount(item) {
        if (
            !item ||
            typeof $gameParty === 'undefined' ||
            !$gameParty ||
            typeof $gameParty.numItems !== 'function'
        ) {
            return null;
        }
        try {
            return clampPositiveInteger($gameParty.numItems(item), 0);
        } catch (error) {
            itemGiverDebugLog(
                `[CabbyCodes] Item Giver: Failed to read count for ${item?.name || 'Unknown Item'}: ${
                    error?.message || error
                }`
            );
            return null;
        }
    }

    /**
     * Selector background panel
     */
    function Window_CabbyCodesSelectorPanel() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesSelectorPanel = Window_CabbyCodesSelectorPanel;

    Window_CabbyCodesSelectorPanel.prototype = Object.create(Window_Base.prototype);
    Window_CabbyCodesSelectorPanel.prototype.constructor = Window_CabbyCodesSelectorPanel;

    Window_CabbyCodesSelectorPanel.prototype.initialize = function(rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this.opacity = 255;
        this.contentsOpacity = 0;
        this.refresh();
    };

    Window_CabbyCodesSelectorPanel.prototype.refresh = function() {
        if (this.contentsBack) {
            this.contentsBack.clear();
            const rect = new Rectangle(0, 0, this.contentsBack.width, this.contentsBack.height);
            this.contentsBack.paintOpacity = 160;
            this.contentsBack.fillRect(rect.x, rect.y, rect.width, rect.height, getGaugeBackColor());
            this.contentsBack.paintOpacity = 255;
        }
    };

    /**
     * Generic dropdown button window (selectable label/value pair)
     */
    function Window_CabbyCodesDropdownButton() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesDropdownButton = Window_CabbyCodesDropdownButton;

    Window_CabbyCodesDropdownButton.prototype = Object.create(Window_Selectable.prototype);
    Window_CabbyCodesDropdownButton.prototype.constructor = Window_CabbyCodesDropdownButton;

    Window_CabbyCodesDropdownButton.prototype.standardPadding = function() {
        const contentPadding = ITEM_GIVER_UI_CONSTANTS.dropdownContentPadding;
        if (typeof contentPadding === 'number') {
            return Math.max(0, contentPadding);
        }
        const outerPadding = ITEM_GIVER_UI_CONSTANTS.dropdownPadding;
        // Give the contents a little less padding than the outer frame so text can center
        return Math.max(0, outerPadding - 4);
    };

    Window_CabbyCodesDropdownButton.prototype.textHorizontalPadding = function() {
        const customPadding = ITEM_GIVER_UI_CONSTANTS.dropdownTextHorizontalPadding;
        if (typeof customPadding === 'number') {
            return Math.max(0, customPadding);
        }
        const outerPadding = ITEM_GIVER_UI_CONSTANTS.dropdownPadding;
        return Math.max(0, outerPadding - 4);
    };

    Window_CabbyCodesDropdownButton.prototype.itemPadding = function() {
        return 0;
    };

    Window_CabbyCodesDropdownButton.prototype.labelValueSpacing = function() {
        const spacing = ITEM_GIVER_UI_CONSTANTS.dropdownLabelValueSpacing;
        if (typeof spacing === 'number') {
            return Math.max(0, spacing);
        }
        return 12;
    };

    Window_CabbyCodesDropdownButton.prototype.initialize = function(rect, label, placeholder) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._label = label || '';
        this._placeholder = placeholder || '';
        this._valueText = '';
        this._currentKey = 'all';
        this._disabled = false;
        this.padding = this.standardPadding();
        this.setBackgroundType(0);
        this.opacity = 255;
        this.deactivate();
        this.refresh();
    };

    Window_CabbyCodesDropdownButton.prototype.maxItems = function() {
        return 1;
    };

    Window_CabbyCodesDropdownButton.prototype.maxCols = function() {
        return 1;
    };

    Window_CabbyCodesDropdownButton.prototype.setValue = function(text) {
        this._valueText = text || '';
        this.refresh();
    };

    Window_CabbyCodesDropdownButton.prototype.setKey = function(key) {
        this._currentKey = key || 'all';
    };

    Window_CabbyCodesDropdownButton.prototype.currentKey = function() {
        return this._currentKey || 'all';
    };

    Window_CabbyCodesDropdownButton.prototype.setDisabled = function(disabled) {
        this._disabled = !!disabled;
        if (this._disabled) {
            this.deselect();
            this.deactivate();
        }
        this.refresh();
    };

    Window_CabbyCodesDropdownButton.prototype.isCurrentItemEnabled = function() {
        return !this._disabled;
    };

    Window_CabbyCodesDropdownButton.prototype.drawItem = function(index) {
        const rect = this.baseRect();
        const textY = rect.y + this._verticalTextOffset();
        const labelPadding = this.textHorizontalPadding();
        const valueRightInset = ITEM_GIVER_UI_CONSTANTS.dropdownValueRightInset || 0;
        const labelValueSpacing = this.labelValueSpacing();
        // Use innerWidth for text positioning (not the extended width from baseRect)
        // The extended width is only for the background to cover the dropdown indicator area
        const textAreaWidth = this.innerWidth;
        const labelX = rect.x + labelPadding;
        const labelText = `${this._label}:`;
        const maxLabelWidth = Math.max(0, textAreaWidth - labelPadding - valueRightInset);
        const measuredLabelWidth = Math.min(maxLabelWidth, this.textWidth(labelText));
        const valueAreaStart = Math.min(
            rect.x + textAreaWidth - valueRightInset,
            labelX + measuredLabelWidth + labelValueSpacing
        );
        const valueWidth = Math.max(0, rect.x + textAreaWidth - valueRightInset - valueAreaStart);
        this.drawBackground();
        this.resetTextColor();
        this.changeTextColor(this.systemColor());
        this.drawText(labelText, labelX, textY, maxLabelWidth, 'left');
        this.resetTextColor();
        this.changePaintOpacity(!this._disabled);
        const text = this._valueText || this._placeholder;
        this.drawText(text, valueAreaStart, textY, valueWidth, 'right');
        this.changePaintOpacity(true);
        
        // Debug: Log text positioning
        console.log('[CabbyCodes] Item Giver: drawItem text positioning', {
            label: this._label,
            textAreaWidth: textAreaWidth,
            rectWidth: rect.width,
            innerWidth: this.innerWidth,
            valueRightInset: valueRightInset,
            valueAreaStart: valueAreaStart,
            valueWidth: valueWidth,
            text: text
        });
    };

    Window_CabbyCodesDropdownButton.prototype.processOk = function() {
        if (this._disabled) {
            SoundManager.playBuzzer();
            return;
        }
        Window_Selectable.prototype.processOk.call(this);
    };

    Window_CabbyCodesDropdownButton.prototype.refresh = function() {
        Window_Selectable.prototype.refresh.call(this);
    };

    Window_CabbyCodesDropdownButton.prototype.processTouch = function() {
        if (!this.isOpen() || !this.visible) {
            return;
        }
        if (TouchInput.isTriggered() && this.isTouchedInsideFrame()) {
            if (this._disabled) {
                SoundManager.playBuzzer();
                return;
            }
            this.playCursorSound();
            this.select(0);
            this.activate();
            this.processOk();
        }
    };

    Window_CabbyCodesDropdownButton.prototype.drawBackground = function() {
        if (this.contentsBack) {
            const rect = this.baseRect();
            const valueRightInset = ITEM_GIVER_UI_CONSTANTS.dropdownValueRightInset || 0;
            // The background should extend to cover the area where the text is drawn
            // Since we override contentsWidth to add valueRightInset, contentsBack is now wider
            // We can draw the background to cover the full extended width
            const extendedWidth = this.contentsWidth();
            const backgroundWidth = extendedWidth;
            
            // Debug: Log background dimensions (always show, no conditional)
            console.log('[CabbyCodes] Item Giver: drawBackground', {
                label: this._label,
                baseRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                valueRightInset: valueRightInset,
                backgroundWidth: backgroundWidth,
                innerWidth: this.innerWidth,
                extendedWidth: extendedWidth,
                windowWidth: this.width,
                padding: this.padding,
                contentsBackWidth: this.contentsBack ? this.contentsBack.width : 'N/A',
                textAreaEnd: this.innerWidth - valueRightInset
            });
            
            this.contentsBack.paintOpacity = 64;
            // Draw background covering the full innerWidth
            this.contentsBack.fillRect(rect.x, rect.y, backgroundWidth, rect.height, getGaugeBackColor());
            this.contentsBack.paintOpacity = 255;
            
            // Debug: Draw visual indicators for background boundaries (always show)
            // Draw red line at the point where text area ends (rect.width - valueRightInset)
            this.contentsBack.paintOpacity = 200;
            const textAreaEnd = rect.width - valueRightInset;
            this.contentsBack.fillRect(rect.x + textAreaEnd, rect.y, 1, rect.height, '#ff0000');
            // Draw green line at background width boundary (should be at innerWidth)
            this.contentsBack.fillRect(rect.x + backgroundWidth - 1, rect.y, 1, rect.height, '#00ff00');
            // Draw blue line at innerWidth boundary (should match green line)
            this.contentsBack.fillRect(rect.x + this.innerWidth - 1, rect.y, 1, rect.height, '#0000ff');
            this.contentsBack.paintOpacity = 255;
        }
    };

    // Override contentsWidth to add space for the right inset (dropdown indicator)
    // This makes the contentsBack bitmap wider, allowing the background to extend further right
    Window_CabbyCodesDropdownButton.prototype.contentsWidth = function() {
        const valueRightInset = ITEM_GIVER_UI_CONSTANTS.dropdownValueRightInset || 0;
        // Add the right inset to innerWidth so the background can cover the dropdown indicator area
        return this.innerWidth + valueRightInset;
    };
    
    Window_CabbyCodesDropdownButton.prototype.baseRect = function() {
        // baseRect should use the extended width from contentsWidth
        const extendedWidth = this.contentsWidth();
        return new Rectangle(0, 0, extendedWidth, this.innerHeight);
    };

    Window_CabbyCodesDropdownButton.prototype._verticalTextOffset = function() {
        const rect = this.baseRect();
        const available = rect.height;
        const lineHeight = this.lineHeight();
        if (available <= lineHeight) {
            return 0;
        }
        return Math.floor((available - lineHeight) / 2);
    };

    Window_CabbyCodesDropdownButton.prototype.updateArrows = function() {
        this.downArrowVisible = false;
        this.upArrowVisible = false;
    };

    Window_CabbyCodesDropdownButton.prototype.ensureCursorVisible = function() {
        this.scrollTo(0, 0);
    };

    /**
     * Generic dropdown list window that appears when selecting options
     */
    function Window_CabbyCodesDropdownList() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesDropdownList = Window_CabbyCodesDropdownList;

    Window_CabbyCodesDropdownList.prototype = Object.create(Window_Selectable.prototype);
    Window_CabbyCodesDropdownList.prototype.constructor = Window_CabbyCodesDropdownList;

    Window_CabbyCodesDropdownList.prototype.initialize = function(rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._options = [];
        this._maxVisibleItems = 6;
        this._opening = false;
        this._closing = false;
        this.openness = 255;
        this.hide();
        this.deactivate();
    };

    Window_CabbyCodesDropdownList.prototype.open = function() {
        this._opening = false;
        this._closing = false;
        this.openness = 255;
        this.show();
        return this;
    };

    Window_CabbyCodesDropdownList.prototype.close = function() {
        this._opening = false;
        this._closing = false;
        this.hide();
        return this;
    };

    Window_CabbyCodesDropdownList.prototype.maxItems = function() {
        return this._options.length;
    };

    Window_CabbyCodesDropdownList.prototype.maxCols = function() {
        return 1;
    };

    Window_CabbyCodesDropdownList.prototype.drawItem = function(index) {
        const rect = this.itemLineRect(index);
        const option = this._options[index];
        if (!option) {
            return;
        }
        this.resetTextColor();
        this.changePaintOpacity(option.enabled !== false);
        this.drawText(option.name, rect.x, rect.y, rect.width, 'left');
        this.changePaintOpacity(true);
    };

    Window_CabbyCodesDropdownList.prototype.setOptions = function(options, currentKey) {
        this._options = Array.isArray(options) ? options : [];
        this._currentKey = currentKey || 'all';
        const visibleItems = Math.min(Math.max(1, this._options.length), this._maxVisibleItems);
        this.height = this.fittingHeight(visibleItems);
        this.createContents();
        Window_Selectable.prototype.refresh.call(this);
        const index = this._options.findIndex(opt => opt.key === this._currentKey);
        this.select(index >= 0 ? index : 0);
    };

    Window_CabbyCodesDropdownList.prototype.optionAt = function(index) {
        return index >= 0 && index < this._options.length ? this._options[index] : null;
    };

    Window_CabbyCodesDropdownList.prototype.currentKey = function() {
        const option = this.optionAt(this.index());
        return option ? option.key : null;
    };

    Window_CabbyCodesDropdownList.prototype.isCurrentItemEnabled = function() {
        const option = this.optionAt(this.index());
        return option ? option.enabled !== false : false;
    };

    Window_CabbyCodesDropdownList.prototype.processOk = function() {
        if (this.isCurrentItemEnabled()) {
            Window_Selectable.prototype.processOk.call(this);
        } else {
            this.playBuzzerSound();
        }
    };

    Window_CabbyCodesDropdownList.prototype.updateArrows = function() {
        this.downArrowVisible = false;
        this.upArrowVisible = false;
    };

    /**
     * Window for displaying and selecting items
     */
    function Window_CabbyCodesItemGiverList() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesItemGiverList = Window_CabbyCodesItemGiverList;

    Window_CabbyCodesItemGiverList.prototype = Object.create(Window_Selectable.prototype);
    Window_CabbyCodesItemGiverList.prototype.constructor = Window_CabbyCodesItemGiverList;

    Window_CabbyCodesItemGiverList.prototype.initialize = function(rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._allItems = [];
        this._data = [];
        this._category = 'all';
        this._searchText = '';
        this._subSectionKey = 'all';
        this._subSectionsByType = {};
        this._subSectionLookup = {};
        this.loadItems();
    };

    Window_CabbyCodesItemGiverList.prototype.loadItems = function() {
        try {
            const result = collectAllItems();
            this._allItems = result?.entries || [];
            this._subSectionsByType = result?.subsections || {};
            this._subSectionLookup = {};
            Object.keys(this._subSectionsByType).forEach(typeKey => {
                const list = this._subSectionsByType[typeKey];
                if (Array.isArray(list)) {
                    list.forEach(sub => {
                        if (sub && sub.key) {
                            this._subSectionLookup[sub.key] = sub;
                        }
                    });
                }
            });
            this.refresh();
        } catch (e) {
            CabbyCodes.error(`[CabbyCodes] Failed to load items: ${e?.message || e}`);
            this._allItems = [];
            this._data = [];
            this._subSectionsByType = {};
            this._subSectionLookup = {};
        }
    };

    Window_CabbyCodesItemGiverList.prototype.resetScrollPosition = function() {
        if (typeof this.scrollTo === 'function') {
            this.scrollTo(0, 0);
        }
        this._scrollY = 0;
        this._scrollTargetY = 0;
    };

    Window_CabbyCodesItemGiverList.prototype.clearListDisplay = function() {
        this._data = [];
        this.select(-1);
        if (this.contents) {
            this.contents.clear();
        }
        if (this.contentsBack) {
            this.contentsBack.clear();
        }
        this.resetScrollPosition();
    };

    Window_CabbyCodesItemGiverList.prototype.setFilters = function(category, searchText, subSectionKey) {
        this.clearListDisplay();
        this._category = normalizeCategory(category);
        this._searchText = searchText ? String(searchText) : '';
        const lookup = this._subSectionLookup || {};
        const normalizedSubKey = subSectionKey && subSectionKey !== 'all' && lookup[subSectionKey]
            ? String(subSectionKey)
            : 'all';
        this._subSectionKey = normalizedSubKey;
        this.refresh();
        this.resetScrollPosition();
        if (this._scene && typeof this._scene.persistCurrentFilters === 'function') {
            this._scene.persistCurrentFilters();
        }
    };

    Window_CabbyCodesItemGiverList.prototype.maxCols = function() {
        return 1;
    };

    Window_CabbyCodesItemGiverList.prototype.maxItems = function() {
        return this._data ? this._data.length : 0;
    };

    Window_CabbyCodesItemGiverList.prototype.item = function() {
        return this.itemAt(this.index());
    };

    Window_CabbyCodesItemGiverList.prototype.itemAt = function(index) {
        return this._data && index >= 0 && index < this._data.length ? this._data[index] : null;
    };

    Window_CabbyCodesItemGiverList.prototype.currentCategory = function() {
        return this._category;
    };

    Window_CabbyCodesItemGiverList.prototype.currentSubSectionKey = function() {
        return this._subSectionKey || 'all';
    };

    Window_CabbyCodesItemGiverList.prototype.currentSearchText = function() {
        return this._searchText || '';
    };

    Window_CabbyCodesItemGiverList.prototype.setSubSectionFilter = function(subSectionKey) {
        const lookup = this._subSectionLookup || {};
        const normalizedKey = subSectionKey && subSectionKey !== 'all' && lookup[subSectionKey]
            ? String(subSectionKey)
            : 'all';
        if (this._subSectionKey !== normalizedKey) {
            this._subSectionKey = normalizedKey;
            this.clearListDisplay();
            this.refresh();
            this.resetScrollPosition();
        }
    };

    Window_CabbyCodesItemGiverList.prototype.availableSubSections = function(type) {
        const normalized = normalizeCategory(type);
        if (normalized === 'all') {
            return [];
        }
        const list = this._subSectionsByType?.[normalized];
        return Array.isArray(list) ? list : [];
    };

    Window_CabbyCodesItemGiverList.prototype.resolveSubSection = function(key) {
        if (!key || key === 'all') {
            return null;
        }
        return this._subSectionLookup?.[key] || null;
    };

    Window_CabbyCodesItemGiverList.prototype.makeItemList = function() {
        const searchLower = (this._searchText || '').trim().toLowerCase();
        const hasSearch = searchLower.length > 0;
        const includeTopLevelHeaders = this._category === 'all' && !hasSearch && (!this._subSectionKey || this._subSectionKey === 'all');
        const activeSubSectionKey = this._subSectionKey && this._subSectionKey !== 'all' ? this._subSectionKey : null;

        this._data = this._allItems.filter(itemData => {
            if (!itemData) {
                return false;
            }

            if (itemData.isSectionHeader) {
                return includeTopLevelHeaders;
            }

            if (!isValidItemEntry(itemData)) {
                return false;
            }

            if (this._category !== 'all' && itemData.type !== this._category) {
                return false;
            }

            if (activeSubSectionKey && itemData.subSectionKey !== activeSubSectionKey) {
                return false;
            }

            if (hasSearch) {
                if (!itemData.name || !itemData.name.toLowerCase().includes(searchLower)) {
                    return false;
                }
            }

            return true;
        });
    };

    Window_CabbyCodesItemGiverList.prototype.drawItem = function(index) {
        try {
            const itemData = this.itemAt(index);
            if (!itemData) {
                return;
            }

            const rect = this.itemLineRect(index);

            if (itemData.isSectionHeader) {
                this.drawSectionHeader(itemData, rect);
                return;
            }

            if (!isValidItemEntry(itemData)) {
                CabbyCodes.warn('[CabbyCodes] Item Giver: Invalid item entry at index ' + index);
                return;
            }

            const item = itemData.item;
            const typeText = itemData.type.charAt(0).toUpperCase() + itemData.type.slice(1);
            const ownedCount = getOwnedItemCount(item);
            const countText = typeof ownedCount === 'number' ? `x${ownedCount}` : '';
            const typeWidth = this.textWidth(typeText);
            const countWidth = countText ? this.textWidth(countText) : 0;
            const countSpacing = countText ? 12 : 0;
            const padding = 12; // Space between name and type
            const rightReservedWidth = typeWidth + countSpacing + countWidth;
            const nameWidth = Math.max(0, rect.width - rightReservedWidth - padding);
            
            this.changePaintOpacity(true);
            // Draw item name (icon + text) - drawItemName handles both
            if (typeof this.drawItemName === 'function') {
                this.drawItemName(item, rect.x, rect.y, nameWidth);
            } else {
                CabbyCodes.warn('[CabbyCodes] Item Giver: drawItemName is not a function');
            }
            // Draw type indicator aligned near the right edge
            const typeX = rect.x + nameWidth + padding;
            this.changeTextColor(this.systemColor());
            this.drawText(typeText, typeX, rect.y, typeWidth, 'left');
            this.resetTextColor();

            if (countText) {
                const countX = rect.x + rect.width - countWidth;
                this.drawText(countText, countX, rect.y, countWidth, 'right');
            }
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error drawing item at index ' + index + ': ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            // Don't throw - just skip drawing this item
        }
    };

    Window_CabbyCodesItemGiverList.prototype.drawSectionHeader = function(itemData, rect) {
        const headerText = itemData?.name || '';
        const paddingX = rect.x + 12;
        const textWidth = rect.width - 24;

        this.resetTextColor();
        this.changeTextColor(this.systemColor());
        this.changePaintOpacity(true);
        this.drawText(headerText, paddingX, rect.y, textWidth, 'left');

        // Draw a subtle line under the header for separation
        if (this.contents) {
            const lineY = rect.y + rect.height - 4;
            this.contents.paintOpacity = 96;
            this.contents.fillRect(rect.x, lineY, rect.width, 2, getGaugeBackColor());
            this.contents.paintOpacity = 255;
        }

        this.resetTextColor();
    };

    Window_CabbyCodesItemGiverList.prototype.isSelectableItem = function(itemData) {
        return isValidItemEntry(itemData);
    };

    Window_CabbyCodesItemGiverList.prototype.isCurrentItemEnabled = function() {
        return this.isSelectableItem(this.item());
    };

    Window_CabbyCodesItemGiverList.prototype.updateHelp = function() {
        try {
            const itemData = this.item();
            // Update description window (not header window)
            if (this._scene) {
                if (isValidItemEntry(itemData)) {
                    const description = itemData.item.description || '';
                    // Use scene's update method to resize window dynamically
                    this._scene.updateDescriptionWindow(description);
                } else {
                    this._scene.updateDescriptionWindow('');
                }
            } else {
                CabbyCodes.warn('[CabbyCodes] Item Giver: Scene is null in updateHelp');
            }
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error updating help: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            // Don't throw - help just won't update
        }
    };
    
    Window_CabbyCodesItemGiverList.prototype.setScene = function(scene) {
        this._scene = scene;
    };
    
    Window_CabbyCodesItemGiverList.prototype.setDescriptionWindow = function(descriptionWindow) {
        this._descriptionWindow = descriptionWindow;
        // Reuse base help-window mechanism to ensure callUpdateHelp triggers.
        this._helpWindow = descriptionWindow;
    };
    
    Window_CabbyCodesItemGiverList.prototype.update = function() {
        Window_Selectable.prototype.update.call(this);
        // Call updateHelp when cursor moves
        this.callUpdateHelp();
    };

    Window_CabbyCodesItemGiverList.prototype.setHelpWindow = function(helpWindow) {
        this._helpWindow = helpWindow;
    };

    Window_CabbyCodesItemGiverList.prototype.setSearchWindow = function(searchWindow) {
        this._searchWindow = searchWindow;
    };

    Window_CabbyCodesItemGiverList.prototype.update = function() {
        try {
            Window_Selectable.prototype.update.call(this);
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in base window update: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            return; // Don't continue if base update fails
        }
        
        try {
            if (this.active && this._searchWindow) {
                // Update search text from search window
                if (typeof this._searchWindow.searchText === 'function') {
                    const searchText = this._searchWindow.searchText();
                    if (searchText !== this._searchText) {
                        this._searchText = searchText;
                        this.refresh();
                    }
                } else {
                    CabbyCodes.warn('[CabbyCodes] Item Giver: _searchWindow.searchText is not a function');
                }
            }
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error updating search text in item window: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            // Don't throw - continue with normal window behavior
        }
    };

    Window_CabbyCodesItemGiverList.prototype.processHandling = function() {
        Window_Selectable.prototype.processHandling.call(this);
        if (!this.isOpenAndActive()) {
            return;
        }

        if (Input.isTriggered('pageup')) {
            this.cycleSubSectionFilter(-1);
        } else if (Input.isTriggered('pagedown')) {
            this.cycleSubSectionFilter(1);
        }
    };

    Window_CabbyCodesItemGiverList.prototype.cycleSubSectionFilter = function(direction) {
        if (!direction || direction === 0) {
            return;
        }

        const category = this.currentCategory();
        const subsections = this.availableSubSections(category);
        if (!subsections || subsections.length === 0) {
            if (category !== 'all') {
                const nextKey = direction > 0 ? 'all' : 'all';
                if (this._subSectionKey !== nextKey) {
                    this.setSubSectionFilter(nextKey);
                    if (this._scene && typeof this._scene.syncSubFilterSelection === 'function') {
                        this._scene.syncSubFilterSelection(nextKey, category);
                    }
                }
            }
            return;
        }

        const options = [{ key: 'all', label: 'All Groups' }, ...subsections];
        let currentIndex = options.findIndex(option => option.key === this.currentSubSectionKey());
        if (currentIndex < 0) {
            currentIndex = 0;
        }
        const nextIndex = (currentIndex + direction + options.length) % options.length;
        const nextKey = options[nextIndex].key;

        if (nextKey === this.currentSubSectionKey()) {
            return;
        }

        this.setSubSectionFilter(nextKey);
        if (this._scene && typeof this._scene.syncSubFilterSelection === 'function') {
            this._scene.syncSubFilterSelection(nextKey, category);
        }
        SoundManager.playCursor();
    };

    Window_CabbyCodesItemGiverList.prototype.refresh = function() {
        try {
            this.makeItemList();
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error making item list: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            this._data = []; // Set empty list on error
        }
        
        try {
            Window_Selectable.prototype.refresh.call(this);
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in base window refresh: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            // Don't throw - window will just not refresh
        }

        this.ensureValidSelection();
    };

    Window_CabbyCodesItemGiverList.prototype.ensureValidSelection = function(preferredIndex) {
        if (!this._data || this._data.length === 0) {
            this.select(-1);
            return;
        }

        let targetIndex = typeof preferredIndex === 'number' ? preferredIndex : this.index();
        if (targetIndex < 0 || targetIndex >= this._data.length) {
            targetIndex = 0;
        }

        if (!this.isSelectableItem(this._data[targetIndex])) {
            const nextIndex = this._data.findIndex(entry => this.isSelectableItem(entry));
            targetIndex = nextIndex >= 0 ? nextIndex : -1;
        }

        this.select(targetIndex);

        if (targetIndex < 0) {
            this.callUpdateHelp();
        }
    };

    /**
     * Quantity input window for item giver
     */
    function Window_CabbyCodesItemQuantity() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesItemQuantity = Window_CabbyCodesItemQuantity;

    Window_CabbyCodesItemQuantity.prototype = Object.create(Window_Selectable.prototype);
    Window_CabbyCodesItemQuantity.prototype.constructor = Window_CabbyCodesItemQuantity;

    Window_CabbyCodesItemQuantity.prototype.initialize = function(rect, itemData, initialValue) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._itemData = itemData;
        this._min = 1;
        // Use Game_Party's maxItems if available, otherwise default to 99
        this._max = (typeof $gameParty !== 'undefined' && typeof $gameParty.maxItems === 'function') 
            ? $gameParty.maxItems(this._itemData ? this._itemData.item : null) 
            : 99;
        this._value = Math.max(this._min, Math.min(this._max, initialValue || 1));
        // Ensure text buffer is always a valid string
        this._textBuffer = String(this._value || this._min);
        this._cursorIndex = this._textBuffer.length; // Cursor at end
        this._cursorCount = 0; // For cursor blinking
        this._boundKeyHandler = this.onKeyDown.bind(this);
        window.addEventListener('keydown', this._boundKeyHandler, true);
        // Force initial refresh to ensure text is drawn
        this.refresh();
    };

    Window_CabbyCodesItemQuantity.prototype.destroy = function(options) {
        window.removeEventListener('keydown', this._boundKeyHandler, true);
        Window_Selectable.prototype.destroy.call(this, options);
    };

    Window_CabbyCodesItemQuantity.prototype.maxItems = function() {
        return 1;
    };

    Window_CabbyCodesItemQuantity.prototype.itemHeight = function() {
        return this.lineHeight();
    };

    Window_CabbyCodesItemQuantity.prototype.drawItem = function(index) {
        if (index !== 0) {
            return;
        }
        try {
            const rect = this.itemLineRect(index);
            const item = this._itemData.item;
            
            // Allow empty text buffer - don't force initialization
            // Only initialize if it's truly null/undefined, not if it's empty string
            if (this._textBuffer === null || this._textBuffer === undefined) {
                this._textBuffer = String(this._min);
                this._value = this._min;
                this._cursorIndex = this._textBuffer.length;
            } else if (this._textBuffer === '') {
                // Empty string is allowed - don't force a value
                this._cursorIndex = this._cursorIndex || 0;
            }
            
            // Simplify layout: Item name on left, value on right (aligned to right edge)
            const currentValueText = this._textBuffer || String(this._value);
            const valueTextWidth = this.textWidth(currentValueText || '99'); // Use max width for layout
            const padding = 8;
            const cursorSpace = 4;
            const valueAreaWidth = Math.max(60, valueTextWidth + cursorSpace + 20);
            
            // Draw item name on the left
            const nameWidth = rect.width - valueAreaWidth - padding;
            if (nameWidth > 50) {
                this.drawItemName(item, rect.x, rect.y, nameWidth);
            }
            
            // Draw value on the right side, aligned to the right edge of the window
            const valueX = rect.x + rect.width - valueAreaWidth;
            this.drawEditableValue(valueX, rect.y, valueAreaWidth);
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error drawing quantity item: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
        }
    };
    
    Window_CabbyCodesItemQuantity.prototype.drawEditableValue = function(x, y, width) {
        // Allow empty text buffer - don't force a value, let user type from scratch
        // Display empty string if buffer is empty, don't force minimum
        const displayText = (this._textBuffer !== null && this._textBuffer !== undefined && this._textBuffer !== '')
            ? String(this._textBuffer) 
            : '';
        
        // Ensure we have valid contents before drawing
        if (!this.contents) {
            CabbyCodes.warn('[CabbyCodes] Item Giver: Contents is null in drawEditableValue');
            return;
        }
        
        // Reset to normal color and draw the number
        this.resetTextColor();
        this.changeTextColor(ColorManager.normalColor());
        
        // Draw the number text - align to right side of the area
        const actualTextWidth = displayText ? this.textWidth(displayText) : 0;
        const drawWidth = width;
        
        // Draw the text aligned to the right
        this.contents.fontSize = this.contents.fontSize || 28;
        this.drawText(displayText || '', x, y, drawWidth, 'right');
        
        // Draw cursor (flashing)
        this._cursorCount = (this._cursorCount || 0) + 1;
        const cursorVisible = Math.floor(this._cursorCount / 30) % 2 === 0; // Blink every 30 frames
        
            if (cursorVisible && this.active) {
            // Calculate cursor position - align to right
            let cursorX = x + width; // Start at right edge
            if (displayText && displayText !== '' && this._cursorIndex > 0 && this._cursorIndex <= displayText.length) {
                // Calculate text width before cursor
                const textBeforeCursor = displayText.substring(0, this._cursorIndex);
                const textBeforeWidth = this.textWidth(textBeforeCursor);
                const fullTextWidth = this.textWidth(displayText);
                // Position cursor from right edge
                cursorX = x + width - fullTextWidth + textBeforeWidth;
            } else if (!displayText || displayText === '') {
                // If no text, cursor is at the right edge
                cursorX = x + width;
            }
            
            // Draw cursor as a vertical line
            const cursorY = y;
            const cursorHeight = this.lineHeight() - 4;
            this.changePaintOpacity(true);
            const cursorColor = (typeof ColorManager !== 'undefined' && typeof ColorManager.textColor === 'function')
                ? ColorManager.textColor(0)
                : (typeof this.normalColor === 'function' ? this.normalColor() : '#ffffff');
            this.contents.fillRect(cursorX, cursorY + 2, 2, cursorHeight, cursorColor);
            this.changePaintOpacity(false);
        }
        
        this.resetTextColor();
    };

    Window_CabbyCodesItemQuantity.prototype.value = function() {
        return this._value;
    };

    Window_CabbyCodesItemQuantity.prototype.processOk = function() {
        this.playOkSound();
        // Final validation before confirming
        this.updateValueFromBuffer();
        
        // Get the requested quantity
        let requestedQuantity = this._value;
        
        // If value is invalid or empty, set to minimum
        if (!requestedQuantity || requestedQuantity < this._min || this._textBuffer === '' || this._textBuffer === null) {
            requestedQuantity = this._min;
        }
        
        // Clamp to max
        requestedQuantity = Math.min(requestedQuantity, this._max);
        
        // Check how many items the player currently has
        const item = this._itemData ? this._itemData.item : null;
        if (item && typeof $gameParty !== 'undefined' && typeof $gameParty.numItems === 'function') {
            const currentCount = $gameParty.numItems(item);
            const maxItems = $gameParty.maxItems(item);
            
            // Calculate how many can actually be added
            const canAdd = Math.max(0, maxItems - currentCount);
            
            // Clamp requested quantity to what can actually be added
            // If user already has max, canAdd will be 0, so actualQuantity will be 0
            const actualQuantity = Math.min(requestedQuantity, canAdd);
            
            // Update the value to what will actually be given
            this._value = actualQuantity;
        } else {
            // Fallback if game party not available
            this._value = Math.max(this._min, Math.min(requestedQuantity, this._max));
        }
        
        // Call the handler - this will be set by the scene
        if (this._okHandler) {
            this._okHandler();
        } else {
            this.callOkHandler();
        }
    };
    
    Window_CabbyCodesItemQuantity.prototype.setOkHandler = function(handler) {
        this._okHandler = handler;
    };
    
    Window_CabbyCodesItemQuantity.prototype.setCancelHandler = function(handler) {
        this._cancelHandler = handler;
    };

    Window_CabbyCodesItemQuantity.prototype.processCancel = function() {
        SoundManager.playCancel();
        this.deactivate();
        // Call the handler - this will be set by the scene
        if (this._cancelHandler) {
            this._cancelHandler();
        } else {
            this.callCancelHandler();
        }
    };

    Window_CabbyCodesItemQuantity.prototype.update = function() {
        Window_Selectable.prototype.update.call(this);
        // Update cursor blink counter and refresh only when cursor visibility changes
        if (this.active && this.isOpen()) {
            const oldCursorCount = this._cursorCount || 0;
            this._cursorCount = oldCursorCount + 1;
            // Refresh every 15 frames to update cursor blink (30 frames per blink cycle)
            if (oldCursorCount % 15 === 0) {
                this.refresh();
            }
        }
    };

    Window_CabbyCodesItemQuantity.prototype.processHandling = function() {
        Window_Selectable.prototype.processHandling.call(this);
        if (this.isOpenAndActive()) {
            // Arrow keys for cursor movement
            if (Input.isRepeated('left')) {
                this.moveCursorLeft();
            } else if (Input.isRepeated('right')) {
                this.moveCursorRight();
            } else if (Input.isRepeated('up')) {
                this.adjustValue(1);
            } else if (Input.isRepeated('down')) {
                this.adjustValue(-1);
            }
        }
    };
    
    Window_CabbyCodesItemQuantity.prototype.moveCursorLeft = function() {
        if (this._cursorIndex > 0) {
            this._cursorIndex--;
            this.playCursorSound();
            this.refresh();
        }
    };
    
    Window_CabbyCodesItemQuantity.prototype.moveCursorRight = function() {
        const maxIndex = (this._textBuffer || String(this._min)).length;
        if (this._cursorIndex < maxIndex) {
            this._cursorIndex++;
            this.playCursorSound();
            this.refresh();
        }
    };

    Window_CabbyCodesItemQuantity.prototype.adjustValue = function(delta) {
        let newValue = this._value + delta;
        newValue = Math.max(this._min, Math.min(this._max, newValue));
        this._value = newValue;
        this._textBuffer = String(newValue);
        this._cursorIndex = this._textBuffer.length; // Move cursor to end
        this.refresh();
    };

    Window_CabbyCodesItemQuantity.prototype.onKeyDown = function(event) {
        if (!this.active) {
            return;
        }
        
        try {
            // Arrow keys for cursor movement
            if (event.key === 'ArrowLeft') {
                this.moveCursorLeft();
                event.preventDefault();
                return;
            } else if (event.key === 'ArrowRight') {
                this.moveCursorRight();
                event.preventDefault();
                return;
            }
            
            // Number input
            if (event.key >= '0' && event.key <= '9') {
                this.inputDigit(event.key);
                event.preventDefault();
            } else if (event.key === 'Backspace' || event.key === 'Delete') {
                this.eraseDigit();
                event.preventDefault();
            } else if (event.key === 'Home') {
                // Move cursor to start
                this._cursorIndex = 0;
                this.playCursorSound();
                this.refresh();
                event.preventDefault();
            } else if (event.key === 'End') {
                // Move cursor to end
                this._cursorIndex = (this._textBuffer || String(this._min)).length;
                this.playCursorSound();
                this.refresh();
                event.preventDefault();
            }
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in onKeyDown: ' + (e?.message || e));
        }
    };

    Window_CabbyCodesItemQuantity.prototype.inputDigit = function(digit) {
        // Ensure text buffer exists
        if (!this._textBuffer || this._textBuffer.trim() === '') {
            this._textBuffer = '';
            this._cursorIndex = 0;
        }
        
        // Check max length (99 = 2 digits)
        const maxDigits = String(this._max).length;
        if (this._textBuffer.length >= maxDigits) {
            // If at max length, replace digit at cursor position
            if (this._cursorIndex < this._textBuffer.length) {
                // Insert/replace at cursor
                const before = this._textBuffer.substring(0, this._cursorIndex);
                const after = this._textBuffer.substring(this._cursorIndex + 1);
                this._textBuffer = before + digit + after;
                // Keep cursor in place (don't move forward when replacing)
            } else {
                // At end, can't add more
                return;
            }
        } else {
            // Insert digit at cursor position
            const before = this._textBuffer.substring(0, this._cursorIndex);
            const after = this._textBuffer.substring(this._cursorIndex);
            this._textBuffer = before + digit + after;
            this._cursorIndex++; // Move cursor forward
        }
        
        this.updateValueFromBuffer();
        this.playCursorSound();
    };

    Window_CabbyCodesItemQuantity.prototype.eraseDigit = function() {
        // Allow empty text - don't force a value back
        if (this._textBuffer === null || this._textBuffer === undefined) {
            this._textBuffer = '';
            this._cursorIndex = 0;
            this.refresh();
            this.playCursorSound();
            return;
        }
        
        const textBuffer = String(this._textBuffer);
        
        if (textBuffer.length === 0) {
            // Already empty, nothing to delete
            return;
        }
        
        // Allow deleting any character, including the first one
        if (this._cursorIndex > 0) {
            // Delete character at cursor position
            const before = textBuffer.substring(0, this._cursorIndex - 1);
            const after = textBuffer.substring(this._cursorIndex);
            this._textBuffer = before + after;
            this._cursorIndex--;
            
            // Allow empty buffer - don't force minimum value
            if (this._textBuffer === '') {
                this._textBuffer = '';
                this._cursorIndex = 0;
                this._value = 0; // Temporary value while editing
            }
        } else {
            // Cursor at start - still allow deleting the first character
            if (textBuffer.length > 0) {
                this._textBuffer = textBuffer.substring(1);
                this._cursorIndex = 0; // Keep cursor at start
                
                // Allow empty buffer
                if (this._textBuffer === '') {
                    this._textBuffer = '';
                    this._cursorIndex = 0;
                    this._value = 0;
                }
            }
        }
        
        this.updateValueFromBuffer();
        this.playCursorSound();
    };

    Window_CabbyCodesItemQuantity.prototype.updateValueFromBuffer = function() {
        // Allow empty text buffer - don't force a value during editing
        if (this._textBuffer === null || this._textBuffer === undefined || this._textBuffer === '') {
            // Empty buffer is allowed - user is typing
            this._value = 0; // Temporary value
            this._cursorIndex = this._cursorIndex || 0;
            this.refresh();
            return;
        }
        
        const textBuffer = String(this._textBuffer);
        
        // Remove leading zeros (except if the whole number is "0")
        let cleanedBuffer = textBuffer;
        if (textBuffer.length > 1 && textBuffer[0] === '0') {
            cleanedBuffer = textBuffer.replace(/^0+/, '') || '0';
            // Adjust cursor if needed
            const cursorAdjust = textBuffer.length - cleanedBuffer.length;
            this._cursorIndex = Math.max(0, this._cursorIndex - cursorAdjust);
            this._textBuffer = cleanedBuffer;
        }
        
        const parsed = Number(cleanedBuffer);
        
        // During editing, don't enforce range - just store the parsed value
        // Range will be enforced when giving the item (in processOk)
        if (Number.isNaN(parsed)) {
            // Invalid - keep text as-is, value stays at 0
            this._value = 0;
        } else {
            // Valid number - store it (even if out of range)
            this._value = parsed;
        }
        
        // Ensure cursor is within bounds
        if (this._cursorIndex > this._textBuffer.length) {
            this._cursorIndex = this._textBuffer.length;
        }
        
        this.refresh();
    };

    /**
     * Main scene for item giver
     */
    function Scene_CabbyCodesItemGiver() {
        this.initialize(...arguments);
    }

    window.Scene_CabbyCodesItemGiver = Scene_CabbyCodesItemGiver;

    Scene_CabbyCodesItemGiver.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesItemGiver.prototype.constructor = Scene_CabbyCodesItemGiver;

    Scene_CabbyCodesItemGiver.prototype.initialize = function() {
        Scene_MenuBase.prototype.initialize.call(this);
        this._initialFiltersApplied = false;
        this._suspendFilterPersistence = false;
    };

    Scene_CabbyCodesItemGiver.prototype.create = function() {
        try {
            Scene_MenuBase.prototype.create.call(this);
            // Create in order: header at top, selectors, description, hidden search window, then item list
            this.createHelpWindow();
            this.createSelectorPanelWindow();
            this.createTypeDropdownButton();
            this.createSubtypeDropdownButton();
            this.createDescriptionWindow();
            this.createSearchWindow();
            this.createItemWindow();
            this.createDropdownListWindow();
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in scene create:', e?.message || e, e?.stack);
            throw e;
        }
    };

    Scene_CabbyCodesItemGiver.prototype.helpAreaHeight = function() {
        // Header window should be small - just fit the header text
        const helpText = 'Select an item to add to inventory';
        const tempWindow = new Window_Help(new Rectangle(0, 0, Graphics.boxWidth, 100));
        const textSize = tempWindow.textSizeEx(helpText);
        const lineHeight = tempWindow.lineHeight();
        tempWindow.destroy();
        const numLines = Math.ceil(textSize.height / lineHeight);
        return this.calcWindowHeight(Math.max(1, numLines), false);
    };

    Scene_CabbyCodesItemGiver.prototype.descriptionAreaHeight = function(text) {
        // Calculate height dynamically based on description text
        if (!text || text === '') {
            return 0; // No height if no text
        }
        const tempWindow = new Window_Help(new Rectangle(0, 0, Graphics.boxWidth, 100));
        const textSize = tempWindow.textSizeEx(text);
        const lineHeight = tempWindow.lineHeight();
        tempWindow.destroy();
        const numLines = Math.ceil(textSize.height / lineHeight);
        // Minimum 1 line, but fit to content
        return this.calcWindowHeight(Math.max(1, numLines), false);
    };

    Scene_CabbyCodesItemGiver.prototype.createHelpWindow = function() {
        // Position header window at top of screen - small, just for header text
        const helpHeight = this.helpAreaHeight();
        const rect = new Rectangle(0, 0, Graphics.boxWidth, helpHeight);
        this._helpWindow = new Window_Help(rect);
        this._helpWindow.setText('Select an item to add to inventory');
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesItemGiver.prototype.createDescriptionWindow = function() {
        // Position description window at bottom of screen
        // Start with minimal height, will resize when content is added
        const initialHeight = this.calcWindowHeight(1, false);
        const rect = new Rectangle(0, Graphics.boxHeight - initialHeight, Graphics.boxWidth, initialHeight);
        this._descriptionWindow = new Window_Help(rect);
        this._descriptionWindow.setText(''); // Start empty
        this.addWindow(this._descriptionWindow);
    };

    Scene_CabbyCodesItemGiver.prototype.descriptionWindowHeight = function() {
        if (this._descriptionWindow) {
            return this._descriptionWindow.height;
        }
        return this.calcWindowHeight(1, false);
    };
    
    Scene_CabbyCodesItemGiver.prototype.updateDescriptionWindow = function(text) {
        if (!this._descriptionWindow) {
            CabbyCodes.warn('[CabbyCodes] Item Giver: Description window is null');
            return;
        }
        
        try {
            // Calculate new height based on text
            const newHeight = this.descriptionAreaHeight(text);
            
            if (newHeight > 0 && text) {
                // Check if we need to resize
                const needsResize = this._descriptionWindow.height !== newHeight;
                
                if (needsResize) {
                    // Resize window - need to recreate contents after resize
                    this._descriptionWindow.height = newHeight;
                    this._descriptionWindow.y = Graphics.boxHeight - newHeight;
                    this._descriptionWindow.createContents();
                } else {
                    // Just reposition if height hasn't changed
                    this._descriptionWindow.y = Graphics.boxHeight - newHeight;
                }
                
                this._descriptionWindow.setText(text);
                // Force refresh and redraw
                this._descriptionWindow.refresh();
            } else {
                // Show minimal window with empty text
                const minHeight = this.calcWindowHeight(1, false);
                const needsResize = this._descriptionWindow.height !== minHeight;
                
                if (needsResize) {
                    this._descriptionWindow.height = minHeight;
                    this._descriptionWindow.createContents();
                }
                this._descriptionWindow.y = Graphics.boxHeight - minHeight;
                this._descriptionWindow.setText('');
                this._descriptionWindow.refresh();
            }
            this.updateItemWindowLayout();
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error updating description window: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
        }
    };

    Scene_CabbyCodesItemGiver.prototype.createSelectorPanelWindow = function() {
        const rect = this.selectorPanelRect();
        this._selectorPanel = new Window_CabbyCodesSelectorPanel(rect);
        this.addWindow(this._selectorPanel);
    };

    Scene_CabbyCodesItemGiver.prototype.createTypeDropdownButton = function() {
        const rect = this.typeDropdownRect();
        this._typeDropdown = new Window_CabbyCodesDropdownButton(rect, 'Type', 'Select type');
        this._typeDropdown.setHandler('ok', this.onTypeDropdownOk.bind(this));
        this._typeDropdown.setHandler('cancel', this.onDropdownButtonCancel.bind(this));
        this._typeDropdown.setValue(this.typeLabelForKey('all'));
        this._typeDropdown.setKey('all');
        this.addWindow(this._typeDropdown);
    };

    Scene_CabbyCodesItemGiver.prototype.createSubtypeDropdownButton = function() {
        const rect = this.subtypeDropdownRect();
        this._subtypeDropdown = new Window_CabbyCodesDropdownButton(rect, 'Subtype', 'Select subtype');
        this._subtypeDropdown.setHandler('ok', this.onSubtypeDropdownOk.bind(this));
        this._subtypeDropdown.setHandler('cancel', this.onDropdownButtonCancel.bind(this));
        this._subtypeDropdown.setValue('All');
        this._subtypeDropdown.setKey('all');
        this._subtypeDropdown.setDisabled(true);
        this.addWindow(this._subtypeDropdown);
    };

    Scene_CabbyCodesItemGiver.prototype.createDropdownListWindow = function() {
        const rect = new Rectangle(0, 0, 360, this.calcWindowHeight(4, true));
        this._dropdownListWindow = new Window_CabbyCodesDropdownList(rect);
        this._dropdownListWindow.setHandler('ok', this.onDropdownListOk.bind(this));
        this._dropdownListWindow.setHandler('cancel', this.onDropdownListCancel.bind(this));
        this.addWindow(this._dropdownListWindow);
    };

    Scene_CabbyCodesItemGiver.prototype.createItemWindow = function() {
        try {
            const rect = this.itemWindowRect();
            this._itemWindow = new Window_CabbyCodesItemGiverList(rect);
            
            if (this._descriptionWindow) {
                this._itemWindow.setDescriptionWindow(this._descriptionWindow);
                this._itemWindow.setScene(this); // Pass scene reference for dynamic resizing
            } else {
                CabbyCodes.warn('[CabbyCodes] Item Giver: Description window is undefined');
            }
            
            if (this._searchWindow) {
                if (typeof this._itemWindow.setSearchWindow === 'function') {
                    this._itemWindow.setSearchWindow(this._searchWindow);
                }
                if (typeof this._searchWindow.setItemWindow === 'function') {
                    this._searchWindow.setItemWindow(this._itemWindow);
                }
            } else {
                CabbyCodes.warn('[CabbyCodes] Item Giver: Search window is undefined');
            }
            
            this._itemWindow.setHandler('ok', this.onItemOk.bind(this));
            this._itemWindow.setHandler('cancel', this.onItemCancel.bind(this));
            this.addWindow(this._itemWindow);
            
            if (typeof this._itemWindow.ensureValidSelection === 'function') {
                this._itemWindow.ensureValidSelection(0);
            }
            
            this._suspendFilterPersistence = true;
            this.refreshSubtypeDropdownState({ skipPersist: true });
            this.applyInitialFilterState();
            this._suspendFilterPersistence = false;
            this.persistCurrentFilters();
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error creating item window:', e?.message || e, e?.stack);
            throw e;
        }
    };

    Scene_CabbyCodesItemGiver.prototype.createSearchWindow = function() {
        const rect = this.searchWindowRect();
        this._searchWindow = new Window_CabbyCodesItemSearch(rect);
        this._searchWindow.deactivate();
        this.addWindow(this._searchWindow);
    };

    Scene_CabbyCodesItemGiver.prototype.searchWindowRect = function() {
        const helpHeight = this.helpAreaHeight();
        const padding = ITEM_GIVER_UI_CONSTANTS.searchHorizontalPadding;
        const wy = helpHeight + this.selectorAreaHeight();
        const ww = Graphics.boxWidth - padding * 2;
        const wh = this.searchWindowHeight();
        return new Rectangle(padding, wy, ww, wh);
    };

    Scene_CabbyCodesItemGiver.prototype.dropdownButtonHeight = function() {
        const lineHeight = this._helpWindow && typeof this._helpWindow.lineHeight === 'function'
            ? this._helpWindow.lineHeight()
            : (typeof Window_Base !== 'undefined' && typeof Window_Base.prototype.lineHeight === 'function'
                ? Window_Base.prototype.lineHeight()
                : 36);
        const padding = Math.max(4, ITEM_GIVER_UI_CONSTANTS.dropdownPadding - 2);
        return lineHeight + padding;
    };

    Scene_CabbyCodesItemGiver.prototype.searchWindowHeight = function() {
        const lineHeight = this._helpWindow && typeof this._helpWindow.lineHeight === 'function'
            ? this._helpWindow.lineHeight()
            : (typeof Window_Base !== 'undefined' && typeof Window_Base.prototype.lineHeight === 'function'
                ? Window_Base.prototype.lineHeight()
                : 36);
        const padding = ITEM_GIVER_UI_CONSTANTS.searchPadding;
        return lineHeight + padding * 2;
    };

    Scene_CabbyCodesItemGiver.prototype.selectorAreaPadding = function() {
        return ITEM_GIVER_UI_CONSTANTS.selectorVerticalGap;
    };

    Scene_CabbyCodesItemGiver.prototype.searchAreaPadding = function() {
        return ITEM_GIVER_UI_CONSTANTS.searchVerticalGap;
    };

    Scene_CabbyCodesItemGiver.prototype.selectorAreaHeight = function() {
        return this.dropdownButtonHeight() + this.selectorAreaPadding();
    };

    Scene_CabbyCodesItemGiver.prototype.searchAreaHeight = function() {
        return this.searchWindowHeight() + this.searchAreaPadding();
    };

    Scene_CabbyCodesItemGiver.prototype.filtersAreaHeight = function() {
        return this.selectorAreaHeight() + this.searchAreaHeight();
    };

    Scene_CabbyCodesItemGiver.prototype.selectorPanelRect = function() {
        const helpHeight = this.helpAreaHeight();
        const wx = 0;
        const wy = helpHeight;
        const ww = Graphics.boxWidth;
        const wh = this.filtersAreaHeight();
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_CabbyCodesItemGiver.prototype.typeDropdownRect = function() {
        const helpHeight = this.helpAreaHeight();
        const paddingLeft = ITEM_GIVER_UI_CONSTANTS.selectorHorizontalPadding;
        const paddingRight = typeof ITEM_GIVER_UI_CONSTANTS.selectorHorizontalPaddingRight === 'number'
            ? ITEM_GIVER_UI_CONSTANTS.selectorHorizontalPaddingRight
            : paddingLeft;
        const widthBonus = ITEM_GIVER_UI_CONSTANTS.selectorCombinedWidthBonus || 0;
        const wy = helpHeight + 6;
        const availableWidth = Math.max(
            paddingLeft + paddingRight + 2,
            Graphics.boxWidth - paddingLeft - paddingRight + widthBonus
        );
        const buttonWidth = availableWidth / 2;
        const wh = this.dropdownButtonHeight();
        
        // Debug: Log rect calculation
        console.log('[CabbyCodes] Item Giver: typeDropdownRect', {
            paddingLeft: paddingLeft,
            paddingRight: paddingRight,
            widthBonus: widthBonus,
            availableWidth: availableWidth,
            buttonWidth: buttonWidth,
            wh: wh
        });
        
        return new Rectangle(paddingLeft, wy, buttonWidth, wh);
    };

    Scene_CabbyCodesItemGiver.prototype.subtypeDropdownRect = function() {
        const helpHeight = this.helpAreaHeight();
        const paddingLeft = ITEM_GIVER_UI_CONSTANTS.selectorHorizontalPadding;
        const paddingRight = typeof ITEM_GIVER_UI_CONSTANTS.selectorHorizontalPaddingRight === 'number'
            ? ITEM_GIVER_UI_CONSTANTS.selectorHorizontalPaddingRight
            : paddingLeft;
        const widthBonus = ITEM_GIVER_UI_CONSTANTS.selectorCombinedWidthBonus || 0;
        const wy = helpHeight + 6;
        const availableWidth = Math.max(
            paddingLeft + paddingRight + 2,
            Graphics.boxWidth - paddingLeft - paddingRight + widthBonus
        );
        const buttonWidth = availableWidth / 2;
        const wh = this.dropdownButtonHeight();
        const wx = paddingLeft + buttonWidth;
        
        // Debug: Log rect calculation
        console.log('[CabbyCodes] Item Giver: subtypeDropdownRect', {
            paddingLeft: paddingLeft,
            paddingRight: paddingRight,
            widthBonus: widthBonus,
            availableWidth: availableWidth,
            buttonWidth: buttonWidth,
            wx: wx,
            wh: wh,
            typeButtonEnd: paddingLeft + buttonWidth
        });
        
        return new Rectangle(wx, wy, buttonWidth, wh);
    };

    Scene_CabbyCodesItemGiver.prototype.itemWindowRect = function() {
        const filtersHeight = this.filtersAreaHeight();
        const helpHeight = this.helpAreaHeight();
        const descHeight = this.descriptionWindowHeight();
        const wx = 0;
        const wy = helpHeight + filtersHeight;
        const ww = Graphics.boxWidth;
        // Fill space between filter block and description window at bottom
        const availableHeight = Graphics.boxHeight - helpHeight - filtersHeight - descHeight;
        const minHeight = this.calcWindowHeight(4, true);
        const wh = Math.max(minHeight, availableHeight);
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_CabbyCodesItemGiver.prototype.typeOptions = function() {
        const options = [{ key: 'all', name: 'All Items' }];
        ITEM_GIVER_SECTION_DEFINITIONS.forEach(def => {
            options.push({ key: def.key, name: def.label });
        });
        return options;
    };

    Scene_CabbyCodesItemGiver.prototype.typeLabelForKey = function(key) {
        if (!key || key === 'all') {
            return 'All Items';
        }
        const match = ITEM_GIVER_SECTION_DEFINITIONS.find(def => def.key === key);
        return match ? match.label : 'All Items';
    };

    Scene_CabbyCodesItemGiver.prototype.subtypeOptionsData = function() {
        if (!this._itemWindow) {
            return [];
        }
        const category = this._itemWindow.currentCategory();
        const subs = this._itemWindow.availableSubSections(category);
        if (!subs || subs.length === 0) {
            return [];
        }
        return subs.map(sub => ({
            key: sub.key,
            name: sub.label
        }));
    };

    Scene_CabbyCodesItemGiver.prototype.subtypeOptions = function() {
        const data = this.subtypeOptionsData();
        const options = [{ key: 'all', name: 'All Subtypes' }];
        data.forEach(entry => options.push(entry));
        this._currentSubtypeOptions = data;
        return options;
    };

    Scene_CabbyCodesItemGiver.prototype.subtypeLabelForKey = function(key) {
        if (!key || key === 'all') {
            return 'All';
        }
        if (!this._currentSubtypeOptions) {
            this._currentSubtypeOptions = this.subtypeOptionsData();
        }
        const match = this._currentSubtypeOptions.find(option => option.key === key);
        return match ? match.name : 'All';
    };

    Scene_CabbyCodesItemGiver.prototype.dropdownListRectForButton = function(button, listHeight) {
        const width = button ? button.width : 320;
        const buttonX = button ? button.x : 0;
        const buttonY = button ? button.y : 0;
        let y = buttonY + button.height;
        if (y + listHeight > Graphics.boxHeight) {
            y = Math.max(0, buttonY - listHeight);
        }
        return new Rectangle(buttonX, y, width, listHeight);
    };

    Scene_CabbyCodesItemGiver.prototype.deactivateSelectorInputs = function() {
        if (this._itemWindow) {
            this._itemWindow.deactivate();
        }
        if (this._typeDropdown) {
            this._typeDropdown.deactivate();
            this._typeDropdown.deselect();
        }
        if (this._subtypeDropdown) {
            this._subtypeDropdown.deactivate();
            this._subtypeDropdown.deselect();
        }
    };

    Scene_CabbyCodesItemGiver.prototype.openDropdown = function(target) {
        if (!this._dropdownListWindow) {
            return;
        }
        const isType = target === 'type';
        const button = isType ? this._typeDropdown : this._subtypeDropdown;
        if (!button || button._disabled) {
            SoundManager.playBuzzer();
            return;
        }
        const options = isType ? this.typeOptions() : this.subtypeOptions();
        if (!options.length) {
            SoundManager.playBuzzer();
            return;
        }
        this.deactivateSelectorInputs();
        this._activeDropdownTarget = target;
        const currentKey = button.currentKey();
        this._dropdownListWindow.setOptions(options, currentKey);
        const rect = this.dropdownListRectForButton(button, this._dropdownListWindow.height);
        this._dropdownListWindow.move(rect.x, rect.y, rect.width, this._dropdownListWindow.height);
        if (typeof this._dropdownListWindow.raise === 'function') {
            this._dropdownListWindow.raise();
        } else if (typeof this._dropdownListWindow.z !== 'undefined') {
            const topZ = Math.max(
                this._itemWindow ? this._itemWindow.z : 0,
                this._typeDropdown ? this._typeDropdown.z : 0,
                this._subtypeDropdown ? this._subtypeDropdown.z : 0
            );
            this._dropdownListWindow.z = topZ + 50;
        }
        this._dropdownListWindow.show();
        this._dropdownListWindow.open();
        this._dropdownListWindow.activate();
    };

    Scene_CabbyCodesItemGiver.prototype.closeDropdownList = function() {
        if (!this._dropdownListWindow) {
            return;
        }
        this._dropdownListWindow.hide();
        this._dropdownListWindow.deactivate();
        this._dropdownListWindow.close();
        this._activeDropdownTarget = null;
    };

    Scene_CabbyCodesItemGiver.prototype.refreshSubtypeDropdownState = function(options = {}) {
        if (!this._subtypeDropdown) {
            return;
        }
        const data = this.subtypeOptionsData();
        const skipPersist = !!options.skipPersist;
        const preserveSelection = !!options.preserveSelection;
        let desiredKey = options.desiredKey;
        this._currentSubtypeOptions = data;
        if (!data.length) {
            this._subtypeDropdown.setDisabled(true);
            this._subtypeDropdown.setValue('All');
            this._subtypeDropdown.setKey('all');
            if (!skipPersist) {
                this.persistCurrentFilters();
            }
            return;
        }
        this._subtypeDropdown.setDisabled(false);
        if (preserveSelection) {
            if (desiredKey && desiredKey !== 'all') {
                const exists = data.some(option => option.key === desiredKey);
                desiredKey = exists ? desiredKey : 'all';
            } else if (desiredKey !== 'all') {
                desiredKey = this._subtypeDropdown.currentKey() || 'all';
            }
            this.syncSubFilterSelection(desiredKey || 'all', { skipPersist });
        } else {
            this._subtypeDropdown.setValue('All');
            this._subtypeDropdown.setKey('all');
            if (!skipPersist) {
                this.persistCurrentFilters();
            }
        }
    };

    Scene_CabbyCodesItemGiver.prototype.syncSubFilterSelection = function(key, options = {}) {
        if (!this._subtypeDropdown) {
            return;
        }
        const label = this.subtypeLabelForKey(key);
        this._subtypeDropdown.setValue(label);
        this._subtypeDropdown.setKey(key || 'all');
        if (!options.skipPersist) {
            this.persistCurrentFilters();
        }
    };

    Scene_CabbyCodesItemGiver.prototype.resetItemListPosition = function() {
        if (!this._itemWindow) {
            return;
        }
        if (typeof this._itemWindow.resetScrollPosition === 'function') {
            this._itemWindow.resetScrollPosition();
        } else if (typeof this._itemWindow.scrollTo === 'function') {
            this._itemWindow.scrollTo(0, 0);
            this._itemWindow._scrollY = 0;
            this._itemWindow._scrollTargetY = 0;
        } else {
            this._itemWindow._scrollY = 0;
            this._itemWindow._scrollTargetY = 0;
        }
        if (typeof this._itemWindow.ensureValidSelection === 'function') {
            this._itemWindow.ensureValidSelection(0);
        } else if (typeof this._itemWindow.select === 'function') {
            this._itemWindow.select(0);
        }
    };

    Scene_CabbyCodesItemGiver.prototype.captureFilterState = function() {
        const typeKey = this._itemWindow && typeof this._itemWindow.currentCategory === 'function'
            ? this._itemWindow.currentCategory()
            : 'all';
        const subKey = this._itemWindow && typeof this._itemWindow.currentSubSectionKey === 'function'
            ? this._itemWindow.currentSubSectionKey()
            : 'all';
        const searchText = this._searchWindow && typeof this._searchWindow.searchText === 'function'
            ? this._searchWindow.searchText()
            : '';
        return {
            type: normalizeCategory(typeKey),
            subtype: typeof subKey === 'string' ? subKey : 'all',
            searchText
        };
    };

    Scene_CabbyCodesItemGiver.prototype.persistCurrentFilters = function() {
        if (this._suspendFilterPersistence || !this._itemWindow) {
            return;
        }
        const state = this.captureFilterState();
        if (state) {
            itemGiverPersistedFilters = state;
        }
    };

    Scene_CabbyCodesItemGiver.prototype.clearPersistedFilters = function() {
        itemGiverPersistedFilters = null;
    };

    Scene_CabbyCodesItemGiver.prototype.applyInitialFilterState = function() {
        if (this._initialFiltersApplied || !this._itemWindow) {
            return;
        }
        this._initialFiltersApplied = true;
        const state = itemGiverPersistedFilters;
        if (state) {
            this.restoreFilterState(state, {
                forceFilters: true,
                skipActivation: true,
                skipPersist: true,
                searchTextOverride: state.searchText
            });
        }
        if (this._itemWindow && typeof this._itemWindow.activate === 'function') {
            this._itemWindow.activate();
        }
    };

    Scene_CabbyCodesItemGiver.prototype.restoreFilterState = function(state, options = {}) {
        if (!state) {
            return;
        }
        const typeKey = normalizeCategory(state.type || 'all');
        const subtypeKey = typeof state.subtype === 'string' ? state.subtype : 'all';
        const forceFilters = !!options.forceFilters;
        const skipActivation = !!options.skipActivation;
        const skipPersist = !!options.skipPersist;
        const searchTextOverride = Object.prototype.hasOwnProperty.call(options, 'searchTextOverride')
            ? options.searchTextOverride
            : undefined;
        const searchText = typeof searchTextOverride === 'string'
            ? searchTextOverride
            : (typeof state.searchText === 'string'
                ? state.searchText
                : (this._searchWindow && typeof this._searchWindow.searchText === 'function'
                    ? this._searchWindow.searchText()
                    : ''));

        if (this._itemWindow && typeof this._itemWindow.setFilters === 'function') {
            const currentType = this._itemWindow.currentCategory
                ? this._itemWindow.currentCategory()
                : 'all';
            const currentSub = this._itemWindow.currentSubSectionKey
                ? this._itemWindow.currentSubSectionKey()
                : 'all';
            const currentSearch = this._itemWindow.currentSearchText
                ? this._itemWindow.currentSearchText()
                : (this._itemWindow._searchText || '');
            const searchChanged = (searchText || '') !== (currentSearch || '');
            if (forceFilters || currentType !== typeKey || currentSub !== subtypeKey || searchChanged) {
                this._itemWindow.setFilters(typeKey, searchText, subtypeKey);
            }
        }

        if (this._typeDropdown) {
            this._typeDropdown.setValue(this.typeLabelForKey(typeKey));
            this._typeDropdown.setKey(typeKey);
        }

        this.refreshSubtypeDropdownState({
            desiredKey: subtypeKey,
            preserveSelection: true,
            skipPersist: true
        });

        if (this._searchWindow && typeof this._searchWindow.setSearchText === 'function') {
            this._searchWindow.setSearchText(searchText || '', { syncFilters: false, forceRefresh: true });
        }

        if (!skipPersist) {
            this.persistCurrentFilters();
        }

        if (!skipActivation && this._itemWindow && typeof this._itemWindow.activate === 'function') {
            this._itemWindow.activate();
        }
    };

    Scene_CabbyCodesItemGiver.prototype.onTypeDropdownOk = function() {
        this.openDropdown('type');
    };

    Scene_CabbyCodesItemGiver.prototype.onSubtypeDropdownOk = function() {
        this.openDropdown('subtype');
    };

    Scene_CabbyCodesItemGiver.prototype.onDropdownButtonCancel = function() {
        if (this._itemWindow) {
            this._itemWindow.activate();
        }
    };

    Scene_CabbyCodesItemGiver.prototype.onDropdownListOk = function() {
        const key = this._dropdownListWindow.currentKey();
        if (!this._activeDropdownTarget) {
            this.closeDropdownList();
            if (this._itemWindow) {
                this._itemWindow.activate();
            }
            return;
        }
        if (this._activeDropdownTarget === 'type') {
            this.applyTypeSelection(key);
        } else {
            this.applySubtypeSelection(key);
        }
    };

    Scene_CabbyCodesItemGiver.prototype.onDropdownListCancel = function() {
        const target = this._activeDropdownTarget;
        this.closeDropdownList();
        const button = target === 'subtype' ? this._subtypeDropdown : this._typeDropdown;
        if (button && !button._disabled) {
            button.activate();
            button.select(0);
        } else if (this._itemWindow) {
            this._itemWindow.activate();
        }
    };

    Scene_CabbyCodesItemGiver.prototype.applyTypeSelection = function(key) {
        const normalized = normalizeCategory(key);
        const label = this.typeLabelForKey(normalized);
        this._typeDropdown.setValue(label);
        this._typeDropdown.setKey(normalized);
        const searchText = this._searchWindow ? this._searchWindow.searchText() : '';
        this._itemWindow.setFilters(normalized, searchText, 'all');
        this._itemWindow.setSubSectionFilter('all');
        this.resetItemListPosition();
        this.refreshSubtypeDropdownState();
        this._subtypeDropdown.setValue('All');
        this._subtypeDropdown.setKey('all');
        this.persistCurrentFilters();
        this.closeDropdownList();
        if (this._itemWindow) {
            this._itemWindow.activate();
        } else if (this._typeDropdown && !this._typeDropdown._disabled) {
            this._typeDropdown.activate();
            this._typeDropdown.select(0);
        }
    };

    Scene_CabbyCodesItemGiver.prototype.applySubtypeSelection = function(key) {
        if (!this._itemWindow) {
            this.closeDropdownList();
            return;
        }
        const label = this.subtypeLabelForKey(key);
        this._subtypeDropdown.setValue(label);
        this._subtypeDropdown.setKey(key || 'all');
        this._itemWindow.setSubSectionFilter(key || 'all');
        this.resetItemListPosition();
        this.persistCurrentFilters();
        this.closeDropdownList();
        this._itemWindow.activate();
    };

    Scene_CabbyCodesItemGiver.prototype.updateItemWindowLayout = function() {
        if (!this._itemWindow) {
            return;
        }
        const rect = this.itemWindowRect();
        this._itemWindow.move(rect.x, rect.y, rect.width, rect.height);
    };

    Scene_CabbyCodesItemGiver.prototype.onItemOk = function() {
        try {
            const itemData = this._itemWindow.item();
            if (isValidItemEntry(itemData)) {
                this.openQuantityWindow(itemData);
            } else {
                CabbyCodes.warn('[CabbyCodes] Item Giver: Invalid or non-selectable item in onItemOk');
                SoundManager.playBuzzer();
                this._itemWindow.activate();
            }
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in onItemOk: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
        }
    };

    Scene_CabbyCodesItemGiver.prototype.onItemCancel = function() {
        if (this._searchWindow) {
            if (typeof this._searchWindow.consumePendingEscapeClear === 'function' &&
                this._searchWindow.consumePendingEscapeClear()) {
                if (this._itemWindow) {
                    this._itemWindow.activate();
                    if (typeof this._itemWindow.ensureValidSelection === 'function') {
                        this._itemWindow.ensureValidSelection(this._itemWindow.index());
                    }
                }
                return;
            }
            if (typeof this._searchWindow.searchText === 'function') {
                const searchText = this._searchWindow.searchText();
                if (searchText && searchText.length > 0) {
                    this._searchWindow.clearSearch();
                    if (this._itemWindow) {
                        this._itemWindow.activate();
                        if (typeof this._itemWindow.ensureValidSelection === 'function') {
                            this._itemWindow.ensureValidSelection(this._itemWindow.index());
                        }
                    }
                    return;
                }
            }
        }
        this.clearPersistedFilters();
        this.popScene();
    };

    Scene_CabbyCodesItemGiver.prototype.start = function() {
        try {
            Scene_MenuBase.prototype.start.call(this);
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in scene start:', e?.message || e, e?.stack);
            throw e;
        }
    };

    Scene_CabbyCodesItemGiver.prototype.update = function() {
        try {
            Scene_MenuBase.prototype.update.call(this);
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in base scene update: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            // Continue to try our custom update logic
        }

        this.updateSearchWindowState();

    };

    Scene_CabbyCodesItemGiver.prototype.openQuantityWindow = function(itemData) {
        try {
            if (!isValidItemEntry(itemData)) {
                CabbyCodes.warn('[CabbyCodes] Item Giver: Tried to open quantity window for invalid item');
                SoundManager.playBuzzer();
                return;
            }
            const callbacks = {
                onApply: (quantity) => {
                    this.addItemToInventory(itemData, quantity);
                },
                onCancel: () => {
                    // Scene will restore filters when it becomes active again.
                }
            };
            // Push first to create the scene instance, then prepare it
            SceneManager.push(Scene_CabbyCodesItemQuantity);
            SceneManager.prepareNextScene(itemData, 1, callbacks);
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error opening quantity window: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
        }
    };

    Scene_CabbyCodesItemGiver.prototype.updateSearchWindowState = function() {
        if (!this._searchWindow) {
            return;
        }
        try {
            const isItemWindowActive = !!(this._itemWindow && this._itemWindow.active);
            if (typeof this._searchWindow.setTypingEnabled === 'function') {
                this._searchWindow.setTypingEnabled(isItemWindowActive);
            }
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error syncing search window state: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
        }
    };

    Scene_CabbyCodesItemGiver.prototype.addItemToInventory = function(itemData, quantity) {
        try {
            if (!isValidItemEntry(itemData)) {
                CabbyCodes.warn('[CabbyCodes] Item Giver: Attempted to add invalid item to inventory');
                SoundManager.playBuzzer();
                return;
            }
            // Only add if quantity is greater than 0
            if (quantity > 0) {
                $gameParty.gainItem(itemData.item, quantity);
                SoundManager.playShop();
            } else {
                SoundManager.playBuzzer();
            }
            // Refresh item window if it exists
            if (this._itemWindow) {
                this._itemWindow.refresh();
                if (typeof this._itemWindow.ensureValidSelection === 'function') {
                    this._itemWindow.ensureValidSelection();
                }
            }
        } catch (e) {
            CabbyCodes.error(`[CabbyCodes] Failed to add item: ${e?.message || e}`);
            SoundManager.playBuzzer();
        }
    };

    /**
     * Quantity input scene
     */
    function Scene_CabbyCodesItemQuantity() {
        this.initialize(...arguments);
    }

    window.Scene_CabbyCodesItemQuantity = Scene_CabbyCodesItemQuantity;

    Scene_CabbyCodesItemQuantity.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesItemQuantity.prototype.constructor = Scene_CabbyCodesItemQuantity;

    Scene_CabbyCodesItemQuantity.prototype.prepare = function(itemData, initialValue, callbacks = {}) {
        this._itemData = itemData;
        this._initialValue = initialValue || 1;
        this._callbacks = callbacks;
    };

    Scene_CabbyCodesItemQuantity.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow(); // Create help window first so it's at the top
        this.createQuantityWindow();
        this.createButtons();
    };

    Scene_CabbyCodesItemQuantity.prototype.helpAreaHeight = function() {
        // Calculate height dynamically based on text
        const maxValue = (typeof $gameParty !== 'undefined' && typeof $gameParty.maxItems === 'function') 
            ? $gameParty.maxItems(this._itemData ? this._itemData.item : null) 
            : 99;
        const helpText = `Enter quantity (1-${maxValue}). Type numbers or use arrow keys.`;
        
        // Calculate text height using textSizeEx
        const tempWindow = new Window_Help(new Rectangle(0, 0, Graphics.boxWidth, 100));
        const textSize = tempWindow.textSizeEx(helpText);
        const lineHeight = tempWindow.lineHeight();
        tempWindow.destroy();
        
        // Calculate number of lines needed
        const numLines = Math.ceil(textSize.height / lineHeight);
        
        // Return height to fit contents
        return this.calcWindowHeight(Math.max(1, numLines), false);
    };

    Scene_CabbyCodesItemQuantity.prototype.createHelpWindow = function() {
        // Calculate dynamic height first
        const helpHeight = this.helpAreaHeight();
        // Position at top of screen
        const rect = new Rectangle(0, 0, Graphics.boxWidth, helpHeight);
        this._helpWindow = new Window_Help(rect);
        const maxValue = (typeof $gameParty !== 'undefined' && typeof $gameParty.maxItems === 'function') 
            ? $gameParty.maxItems(this._itemData ? this._itemData.item : null) 
            : 99;
        // Window_Help uses drawTextEx which automatically wraps text
        this._helpWindow.setText(`Enter quantity (1-${maxValue}). Type numbers or use arrow keys.`);
        this.addWindow(this._helpWindow);
    };
    
    Scene_CabbyCodesItemQuantity.prototype.createButtons = function() {
        // Create text-based button window
        this.createButtonWindow();
    };
    
    Scene_CabbyCodesItemQuantity.prototype.createButtonWindow = function() {
        const buttonHeight = this.calcWindowHeight(1, true);
        const spacing = 8;
        // Calculate button width - enough for "OK" and "Cancel" with spacing
        const buttonWidth = 200; // Appropriate width for two buttons
        const wx = (Graphics.boxWidth - buttonWidth) / 2; // Center horizontally
        // Position buttons below the quantity window
        const quantityWindowBottom = this.quantityWindowRect().y + this.quantityWindowRect().height;
        const wy = quantityWindowBottom + spacing;
        const rect = new Rectangle(wx, wy, buttonWidth, buttonHeight);
        this._buttonWindow = new Window_CabbyCodesItemQuantityButtons(rect);
        this._buttonWindow.setHandler('ok', this.onButtonOk.bind(this));
        this._buttonWindow.setHandler('cancel', this.onButtonCancel.bind(this));
        this.addWindow(this._buttonWindow);
        this._buttonWindow.activate();
        this._buttonWindow.select(0); // Select OK by default
    };
    
    Scene_CabbyCodesItemQuantity.prototype.onButtonOk = function() {
        // Call the quantity window's processOk directly, which will call the handler
        if (this._quantityWindow) {
            this._quantityWindow.processOk();
        }
    };
    
    Scene_CabbyCodesItemQuantity.prototype.onButtonCancel = function() {
        if (this._quantityWindow) {
            this._quantityWindow.processCancel();
        }
    };

    Scene_CabbyCodesItemQuantity.prototype.quantityWindowRect = function() {
        const helpHeight = this.helpAreaHeight();
        const buttonHeight = this.calcWindowHeight(1, true);
        const spacing = 8;
        const ww = 360;
        const wh = this.calcWindowHeight(1, true); // Smaller height - just fit the item row
        const wx = (Graphics.boxWidth - ww) / 2;
        // Position below help window at top, above buttons
        const wy = helpHeight + 24;
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_CabbyCodesItemQuantity.prototype.createQuantityWindow = function() {
        const rect = this.quantityWindowRect();
        this._quantityWindow = new Window_CabbyCodesItemQuantity(rect, this._itemData, this._initialValue);
        // Set handlers for button clicks
        this._quantityWindow.setOkHandler(this.onQuantityOk.bind(this));
        this._quantityWindow.setCancelHandler(this.onQuantityCancel.bind(this));
        this.addWindow(this._quantityWindow);
        // Quantity window uses keydown event listener, so it doesn't need to be active
        // But we'll keep it selectable for visual feedback
        this._quantityWindow.activate();
        this._quantityWindow.select(0);
    };
    
    Scene_CabbyCodesItemQuantity.prototype.update = function() {
        Scene_MenuBase.prototype.update.call(this);
    };

    Scene_CabbyCodesItemQuantity.prototype.onQuantityOk = function() {
        // Prevent double calls
        if (this._processingOk) {
            CabbyCodes.warn('[CabbyCodes] Item Giver: onQuantityOk already processing, ignoring duplicate call');
            return;
        }
        this._processingOk = true;
        
        try {
            const quantity = this._quantityWindow.value();
            if (this._callbacks && typeof this._callbacks.onApply === 'function') {
                this._callbacks.onApply(quantity);
            } else {
                CabbyCodes.warn('[CabbyCodes] Item Giver: onApply callback is not available');
            }
            SceneManager.pop();
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in onQuantityOk: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            SceneManager.pop(); // Still pop even on error
        } finally {
            this._processingOk = false;
        }
    };

    Scene_CabbyCodesItemQuantity.prototype.onQuantityCancel = function() {
        if (this._callbacks && typeof this._callbacks.onCancel === 'function') {
            this._callbacks.onCancel();
        }
        SceneManager.pop();
    };

    /**
     * Search input window - simplified to show search text and handle via keyboard
     */
    function Window_CabbyCodesItemSearch() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesItemSearch = Window_CabbyCodesItemSearch;

    Window_CabbyCodesItemSearch.prototype = Object.create(Window_Base.prototype);
    Window_CabbyCodesItemSearch.prototype.constructor = Window_CabbyCodesItemSearch;

    Window_CabbyCodesItemSearch.prototype.standardPadding = function() {
        return ITEM_GIVER_UI_CONSTANTS.searchPadding;
    };

    Window_CabbyCodesItemSearch.prototype.initialize = function(rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this._searchText = '';
        this._isTypingEnabled = false;
        this._pendingEscapeClear = false;
        this._boundKeyHandler = this.onKeyDown.bind(this);
        window.addEventListener('keydown', this._boundKeyHandler, true);
        this.refresh();
    };

    Window_CabbyCodesItemSearch.prototype.destroy = function(options) {
        window.removeEventListener('keydown', this._boundKeyHandler, true);
        Window_Base.prototype.destroy.call(this, options);
    };

    Window_CabbyCodesItemSearch.prototype.searchText = function() {
        return this._searchText;
    };

    Window_CabbyCodesItemSearch.prototype.setSearchText = function(text, options = {}) {
        const normalized = typeof text === 'string' ? text : '';
        const changed = this._searchText !== normalized;
        this._searchText = normalized;
        if (changed || options.forceRefresh) {
            this.refresh();
        }
        if (options.syncFilters) {
            this.syncItemWindowFilters();
        }
    };

    Window_CabbyCodesItemSearch.prototype.clearSearch = function() {
        this.setSearchText('', { syncFilters: true });
    };

    Window_CabbyCodesItemSearch.prototype.setItemWindow = function(itemWindow) {
        this._itemWindow = itemWindow;
    };

    Window_CabbyCodesItemSearch.prototype.consumeKeyboardEvent = function(event) {
        if (!event) {
            return;
        }
        if (typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        if (typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }
        if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
        }
    };

    Window_CabbyCodesItemSearch.prototype.consumePendingEscapeClear = function() {
        if (this._pendingEscapeClear) {
            this._pendingEscapeClear = false;
            return true;
        }
        return false;
    };

    Window_CabbyCodesItemSearch.prototype.activate = function() {
        this.setTypingEnabled(true);
    };

    Window_CabbyCodesItemSearch.prototype.deactivate = function() {
        this.setTypingEnabled(false);
    };

    Window_CabbyCodesItemSearch.prototype.setTypingEnabled = function(enabled) {
        const next = !!enabled;
        if (this._isTypingEnabled === next) {
            return;
        }
        this._isTypingEnabled = next;
        this.refresh();
    };

    Window_CabbyCodesItemSearch.prototype.canCaptureInput = function() {
        return !!this._isTypingEnabled;
    };

    Window_CabbyCodesItemSearch.prototype.refresh = function() {
        try {
            if (!this.contents) {
                this.createContents();
            } else {
                this.contents.clear();
            }
            if (this.contentsBack) {
                this.contentsBack.clear();
            }
            this.drawAllItems();
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error refreshing search window: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
        }
    };

    Window_CabbyCodesItemSearch.prototype.drawAllItems = function() {
        try {
            const rect = this.baseTextRect();
            const label = 'Filter';
            const spacing = 12;
            const labelWidth = this.textWidth(label);
            const hintText = this._searchText ? '(Esc to clear)' : '';
            const hintWidth = hintText ? this.textWidth(hintText) : 0;
            const reservedHintWidth = hintWidth ? hintWidth + spacing : 0;
            const availableWidth = rect.width - labelWidth - spacing - reservedHintWidth;
            const fieldWidth = Math.max(60, availableWidth);
            const fieldRect = new Rectangle(
                rect.x + labelWidth + spacing,
                rect.y,
                fieldWidth,
                rect.height
            );

            this.changeTextColor(this.systemColor());
            this.drawText(label, rect.x, rect.y, labelWidth, 'left');
            this.resetTextColor();

            this.drawFilterBackground(fieldRect);

            const displayText = this._searchText
                ? this._searchText
                : (this._isTypingEnabled ? 'Type to filter items' : 'Select the list to type');
            const textPadding = ITEM_GIVER_UI_CONSTANTS.searchPadding;
            const textWidth = Math.max(0, fieldRect.width - textPadding * 2);
            this.changeTextColor(this._searchText ? getNormalColor(this) : getGaugeBackColor());
            this.drawText(displayText, fieldRect.x + textPadding, rect.y, textWidth, 'left');
            this.resetTextColor();

            if (hintText && hintWidth > 0) {
                const hintX = fieldRect.x + fieldRect.width + spacing;
                this.changeTextColor(this.systemColor());
                this.drawText(hintText, hintX, rect.y, hintWidth, 'left');
                this.resetTextColor();
            }
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in drawAllItems: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            // Don't throw - just skip drawing
        }
    };

    Window_CabbyCodesItemSearch.prototype.drawFilterBackground = function(rect) {
        const target = this.contentsBack || this.contents;
        if (!target) {
            return;
        }
        const previousOpacity = target.paintOpacity;
        target.paintOpacity = 160;
        target.fillRect(rect.x, rect.y, rect.width, rect.height, getGaugeBackColor());
        target.paintOpacity = previousOpacity;
    };

    Window_CabbyCodesItemSearch.prototype.isTouchedInsideFrame = function() {
        const touchPos = new Point(TouchInput.x, TouchInput.y);
        const localPos = this.worldTransform.applyInverse(touchPos);
        return this.innerRect.contains(localPos.x, localPos.y);
    };

    Window_CabbyCodesItemSearch.prototype.update = function() {
        Window_Base.prototype.update.call(this);
        this.processPointer();
    };

    Window_CabbyCodesItemSearch.prototype.processPointer = function() {
        if (!this.visible || !this.isOpen()) {
            return;
        }
        if (TouchInput.isTriggered() && this.isTouchedInsideFrame()) {
            if (this._itemWindow && typeof this._itemWindow.activate === 'function') {
                const wasActive = !!this._itemWindow.active;
                this._itemWindow.activate();
                if (typeof this._itemWindow.ensureValidSelection === 'function') {
                    this._itemWindow.ensureValidSelection(this._itemWindow.index());
                }
                if (!wasActive) {
                    SoundManager.playCursor();
                }
            }
        }
    };

    Window_CabbyCodesItemSearch.prototype.syncItemWindowFilters = function() {
        if (!this._itemWindow || typeof this._itemWindow.setFilters !== 'function') {
            return;
        }
        const category = typeof this._itemWindow.currentCategory === 'function'
            ? this._itemWindow.currentCategory()
            : (this._itemWindow._category || 'all');
        const subKey = typeof this._itemWindow.currentSubSectionKey === 'function'
            ? this._itemWindow.currentSubSectionKey()
            : 'all';
        this._itemWindow.setFilters(category, this._searchText || '', subKey);
    };

    /**
     * Button window for OK/Cancel in quantity scene
     */
    function Window_CabbyCodesItemQuantityButtons() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesItemQuantityButtons = Window_CabbyCodesItemQuantityButtons;

    Window_CabbyCodesItemQuantityButtons.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesItemQuantityButtons.prototype.constructor = Window_CabbyCodesItemQuantityButtons;

    Window_CabbyCodesItemQuantityButtons.prototype.initialize = function(rect) {
        Window_Command.prototype.initialize.call(this, rect);
    };

    Window_CabbyCodesItemQuantityButtons.prototype.makeCommandList = function() {
        this.addCommand('OK', 'ok');
        this.addCommand('Cancel', 'cancel');
    };

    Window_CabbyCodesItemQuantityButtons.prototype.maxCols = function() {
        return 2;
    };

    Window_CabbyCodesItemSearch.prototype.onKeyDown = function(event) {
        try {
            if (!event || !event.key) {
                return;
            }

            if (!this.canCaptureInput()) {
                return;
            }

            if (event.ctrlKey || event.metaKey || event.altKey) {
                return;
            }

            if (event.key.length === 1) {
                const nextValue = (this._searchText || '') + event.key;
                this.setSearchText(nextValue, { syncFilters: true });
                this.consumeKeyboardEvent(event);
            } else if (event.key === 'Backspace' || event.key === 'Delete') {
                if (this._searchText && this._searchText.length > 0) {
                    this.setSearchText(this._searchText.slice(0, -1), { syncFilters: true });
                } else {
                    this.setSearchText('', { syncFilters: false, forceRefresh: true });
                }
                this.consumeKeyboardEvent(event);
            } else if (event.key === 'Escape') {
                if (this._searchText) {
                    this.clearSearch();
                    this._pendingEscapeClear = true;
                    this.consumeKeyboardEvent(event);
                }
            }
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in search window onKeyDown: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            // Don't throw - just ignore the key press
        }
    };

    //--------------------------------------------------------------------------
    // Bulk Item Shortcuts
    //--------------------------------------------------------------------------

    const GIVE_ALL_ITEMS_SETTING_KEY = 'giveAllItems';
    const MAX_ALL_ITEMS_SETTING_KEY = 'maxAllItems';
    const MAX_ALL_ITEMS_LABEL = 'Max Items in Inventory';
    const BULK_ITEM_SHORTCUT_RESET_DELAY_MS = 50;
    const CABBYCODES_OPTION_SYMBOL_PREFIX = 'cabbycodes_';
    const ITEM_GIVER_SETTING_SYMBOL = `${CABBYCODES_OPTION_SYMBOL_PREFIX}itemGiver`;
    const GIVE_ALL_ITEMS_SYMBOL = `${CABBYCODES_OPTION_SYMBOL_PREFIX}${GIVE_ALL_ITEMS_SETTING_KEY}`;
    const MAX_ALL_ITEMS_SYMBOL = `${CABBYCODES_OPTION_SYMBOL_PREFIX}${MAX_ALL_ITEMS_SETTING_KEY}`;
    const MAX_ALL_ITEMS_CONFIRMATION_TEXT =
        'WARNING:\n' +
        'This fills every grantable item you already have in your inventory to its maximum stack size.\n' +
        'Proceed?';

    function parseDatabaseIndex(value, { allowZero = false } = {}) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return null;
        }
        const floored = Math.floor(numeric);
        if (!allowZero && floored <= 0) {
            return null;
        }
        if (allowZero && floored < 0) {
            return null;
        }
        return floored;
    }

    function getDatabaseCollectionForType(type) {
        switch (type) {
            case 'item':
                return typeof $dataItems !== 'undefined' ? $dataItems : null;
            case 'weapon':
                return typeof $dataWeapons !== 'undefined' ? $dataWeapons : null;
            case 'armor':
                return typeof $dataArmors !== 'undefined' ? $dataArmors : null;
            default:
                return null;
        }
    }

    function isGrantableDatabaseItem(item, type) {
        if (!item) {
            return false;
        }
        const validator = ITEM_GIVER_TYPE_VALIDATORS[type];
        if (typeof validator !== 'function') {
            return false;
        }
        return validator(item) && hasUsableName(item);
    }

    function resolveRangedWeaponGrant(entry) {
        if (!entry || !entry.item || typeof entry.item.meta !== 'object') {
            return null;
        }
        const meta = entry.item.meta;
        if (typeof meta.emptyOb === 'undefined' || typeof meta.maxAmmo === 'undefined') {
            return null;
        }

        const baseId = parseDatabaseIndex(meta.emptyOb);
        const maxAmmo = parseDatabaseIndex(meta.maxAmmo);
        if (!baseId || !maxAmmo) {
            return null;
        }

        // Ranged "weapons" actually live in $dataArmors (etypeId === 2) but present as
        // type === 'weapon' in the UI. Look up the full variant against sourceType so we
        // hit the right database — using `type` returned $dataWeapons, whose entries at
        // these indices are unrelated melee items (or empty), causing the dedup pass to
        // fall back to entry.item, which is the first iterated non-empty variant
        // ("loaded, but almost empty"). That is why the bulk shortcuts kept granting
        // partially-loaded guns.
        const sourceType = typeof entry.sourceType === 'string' ? entry.sourceType : entry.type;
        const dataSource = getDatabaseCollectionForType(sourceType);
        if (!dataSource || !Array.isArray(dataSource)) {
            return null;
        }

        const hasBigBurst = typeof meta.bigburstNeed !== 'undefined';
        const hasBurst = typeof meta.burstNeed !== 'undefined';
        const fullOffset = hasBigBurst ? 4 : hasBurst ? 3 : 2;
        const fullId = baseId + fullOffset;
        const fullItem = dataSource[fullId];
        const grantItem = isGrantableDatabaseItem(fullItem, sourceType) ? fullItem : entry.item;

        const wpnIndex = parseDatabaseIndex(meta.wpnIndex, { allowZero: true });
        const groupKey = Number.isInteger(wpnIndex)
            ? `ammoWeapon:${wpnIndex}`
            : `ammoWeaponBase:${baseId}`;

        return {
            groupKey,
            item: grantItem
        };
    }

    function resolveGrantableCatalogItem(entry) {
        if (!entry) {
            return null;
        }
        const rangedGrant = resolveRangedWeaponGrant(entry);
        if (!rangedGrant) {
            return {
                item: entry.item,
                rangedGroupKey: null
            };
        }
        return {
            item: rangedGrant.item || entry.item,
            rangedGroupKey: rangedGrant.groupKey || null
        };
    }

    function iterateGainableItemCatalog(visitor, filterFn) {
        if (typeof visitor !== 'function') {
            return 0;
        }
        const catalog = collectAllItems();
        const entries = catalog && Array.isArray(catalog.entries) ? catalog.entries : null;
        if (!entries || entries.length === 0) {
            return 0;
        }

        const rangedGrantTracker = new Set();
        let processed = 0;
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (!isGrantableCatalogEntry(entry)) {
                continue;
            }
            if (shouldSkipCatalogEntry(entry)) {
                continue;
            }
            if (typeof filterFn === 'function' && !filterFn(entry)) {
                continue;
            }

            const resolved = resolveGrantableCatalogItem(entry);
            const grantableItem = resolved?.item;
            const rangedGroupKey = resolved?.rangedGroupKey;
            if (!grantableItem) {
                continue;
            }

            if (rangedGroupKey) {
                if (rangedGrantTracker.has(rangedGroupKey)) {
                    continue;
                }
                rangedGrantTracker.add(rangedGroupKey);
            }

            processed += 1;
            visitor(grantableItem, entry);
        }
        return processed;
    }

    function isGrantableCatalogEntry(entry) {
        if (!isValidItemEntry(entry)) {
            return false;
        }
        // Planet / puzzle discs are itypeId === 2 but are collectibles the
        // player expects bulk shortcuts to cover — they have no quest-counter
        // semantics, so granting missing ones is safe.
        if (isKeyItemData(entry.item) && !hasWDItemsTag(entry.item, 'discobj')) {
            return false;
        }
        if (isPseudoKeyCatalogItem(entry.item)) {
            return false;
        }
        return true;
    }

    function isKeyItemData(item) {
        if (!item) {
            return false;
        }
        const typeId = Number(item.itypeId);
        return Number.isFinite(typeId) && typeId === 2;
    }

    // Regular items (itypeId === 1) that the game treats as key-item-like:
    // given/taken by scripted events in specific counts. Bulk shortcuts
    // (Give Missing Items, Max Items in Inventory) must skip these so
    // they do not desync quest counters. Individual granting through the
    // main Item Giver UI is unaffected — it uses collectAllItems(), not
    // isGrantableCatalogEntry().
    const PSEUDO_KEY_CATALOG_ITEM_IDS = new Set([
        5,   // Rat Baby Thing
        128, // Marc-André (napping)
        283, // Empty Lunchbox
        284, // Papineau's Lunch
        286, // Ice Melt Salt
        289, // Sapper Charge
        291, // Dog Tags
        320, // Simple Key
        354, // Eye
        359, // Cassette Tape
        361, // Four-Leaf Clover
        367, // Tickle's Gift
        372, // Tired Medic-in-a-Jar
        375, // Rat Tail
        379, // Plumbing Tools
        381, // Potting Soil
        382, // Worm Egg
        396, // Rebreather
        651, // green key
        652, // red key
        653, // yellow key
        654, // blue key
        655, // white key
        656  // black key
    ]);

    function isPseudoKeyCatalogItem(item) {
        if (!item) {
            return false;
        }
        return PSEUDO_KEY_CATALOG_ITEM_IDS.has(item.id);
    }

    function ensureGamePartyForItemShortcuts(actionName) {
        if (typeof $gameParty === 'undefined' || !$gameParty) {
            CabbyCodes.warn(
                `[CabbyCodes] ${actionName}: Game data is not ready. Load a save before using this option.`
            );
            return null;
        }
        if (typeof $gameParty.gainItem !== 'function') {
            CabbyCodes.warn(
                `[CabbyCodes] ${actionName}: gainItem is unavailable; cannot modify inventory.`
            );
            return null;
        }
        return $gameParty;
    }

    function scheduleBulkItemShortcutReset(settingKey) {
        if (typeof setTimeout === 'function') {
            setTimeout(() => {
                CabbyCodes.setSetting(settingKey, false);
            }, BULK_ITEM_SHORTCUT_RESET_DELAY_MS);
        } else {
            CabbyCodes.setSetting(settingKey, false);
        }
    }

    function playBulkItemShortcutSound(success) {
        if (typeof SoundManager === 'undefined') {
            return;
        }
        if (success && typeof SoundManager.playShop === 'function') {
            SoundManager.playShop();
        } else if (!success && typeof SoundManager.playBuzzer === 'function') {
            SoundManager.playBuzzer();
        }
    }

    function clampPositiveInteger(value, fallback = 0) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return Math.max(0, Math.floor(fallback));
        }
        return Math.max(0, Math.floor(numeric));
    }

    function entryMatchesGiveMissingFilter(entry, filter) {
        if (!filter) {
            return true;
        }
        if (filter.type && entry?.type !== filter.type) {
            return false;
        }
        if (filter.subtype && entry?.subSectionKey !== filter.subtype) {
            return false;
        }
        return true;
    }

    function performGiveMissingItems(filter, optionLabel) {
        const actionLabel = optionLabel
            ? `Give Missing Items (${optionLabel})`
            : 'Give Missing Items';
        const party = ensureGamePartyForItemShortcuts(actionLabel);
        if (!party) {
            return { success: false, processed: 0, granted: 0 };
        }
        if (typeof party.numItems !== 'function') {
            CabbyCodes.warn(
                `[CabbyCodes] ${actionLabel}: numItems is unavailable; cannot determine owned quantities.`
            );
            return { success: false, processed: 0, granted: 0 };
        }
        let granted = 0;
        const filterFn = filter
            ? entry => entryMatchesGiveMissingFilter(entry, filter)
            : null;
        const processed = iterateGainableItemCatalog(item => {
            const owned = clampPositiveInteger(party.numItems(item), 0);
            if (owned > 0) {
                return;
            }
            try {
                party.gainItem(item, 1);
                granted += 1;
            } catch (error) {
                CabbyCodes.error(
                    `[CabbyCodes] ${actionLabel}: Failed to add ${item?.name || 'Unknown Item'}: ${
                        error?.message || error
                    }`
                );
            }
        }, filterFn);
        if (processed === 0) {
            CabbyCodes.warn(
                `[CabbyCodes] ${actionLabel}: No catalog entries were processed. Make sure game data is loaded.`
            );
        } else if (granted === 0) {
            CabbyCodes.log(
                `[CabbyCodes] ${actionLabel}: Inventory already contains every catalog entry in this category.`
            );
        } else {
            CabbyCodes.log(
                `[CabbyCodes] ${actionLabel} granted ${granted} previously missing entries (out of ${processed} catalog entries).`
            );
        }
        playBulkItemShortcutSound(granted > 0);
        return { success: granted > 0, processed, granted };
    }

    function performMaxItemsInInventory() {
        const actionName = MAX_ALL_ITEMS_LABEL;
        const party = ensureGamePartyForItemShortcuts(actionName);
        if (!party) {
            return { success: false, processed: 0, adjusted: 0 };
        }
        if (
            typeof party.maxItems !== 'function' ||
            typeof party.numItems !== 'function'
        ) {
            CabbyCodes.warn(
                `[CabbyCodes] ${actionName}: Inventory helpers are unavailable; cannot determine stack limits.`
            );
            return { success: false, processed: 0, adjusted: 0 };
        }
        let adjusted = 0;
        let processed = 0;
        const catalogEntries = iterateGainableItemCatalog(item => {
            const currentQuantity = clampPositiveInteger(
                party.numItems(item),
                0
            );
            if (currentQuantity <= 0) {
                return;
            }
            processed += 1;
            const maxQuantity = clampPositiveInteger(
                party.maxItems(item),
                99
            );
            const missing = maxQuantity - currentQuantity;
            if (missing > 0) {
                try {
                    party.gainItem(item, missing);
                    adjusted += 1;
                } catch (error) {
                    CabbyCodes.error(
                        `[CabbyCodes] ${actionName}: Failed to adjust ${item?.name || 'Unknown Item'}: ${
                            error?.message || error
                        }`
                    );
                }
            }
        });
        if (catalogEntries === 0) {
            CabbyCodes.warn(
                `[CabbyCodes] ${actionName}: No catalog entries were processed. Make sure game data is loaded.`
            );
        } else if (processed === 0) {
            CabbyCodes.log(
                `[CabbyCodes] ${actionName}: No eligible inventory entries were found.`
            );
        } else {
            CabbyCodes.log(
                `[CabbyCodes] ${actionName} ensured max stacks for ${processed} inventory entries (${adjusted} required changes).`
            );
        }
        playBulkItemShortcutSound(processed > 0);
        return { success: catalogEntries > 0, processed, adjusted };
    }

    function triggerGiveMissingItemsShortcut(filter, optionLabel) {
        const result = performGiveMissingItems(filter, optionLabel);
        if (!result.success) {
            CabbyCodes.warn(
                '[CabbyCodes] Give Missing Items could not run. Load a save before pressing this option.'
            );
        }
        scheduleBulkItemShortcutReset(GIVE_ALL_ITEMS_SETTING_KEY);
        return result;
    }

    function buildGiveMissingItemsMenuOptions() {
        const options = [
            { id: 'all', label: 'All', filter: null }
        ];
        let catalog;
        try {
            catalog = collectAllItems();
        } catch (error) {
            CabbyCodes.warn(
                '[CabbyCodes] Give Missing Items: Failed to enumerate categories: ' +
                    (error?.message || error)
            );
            return options;
        }
        const subsections = catalog && catalog.subsections;
        if (!subsections) {
            return options;
        }
        ITEM_GIVER_SECTION_DEFINITIONS.forEach(sectionDef => {
            const subs = subsections[sectionDef.key];
            if (!Array.isArray(subs) || subs.length === 0) {
                return;
            }
            options.push({
                id: `type:${sectionDef.key}`,
                label: `All ${sectionDef.label}`,
                filter: { type: sectionDef.key }
            });
            subs.forEach(sub => {
                if (!sub || !sub.key) {
                    return;
                }
                options.push({
                    id: `sub:${sub.key}`,
                    label: `  ${sub.label || sub.key}`,
                    filter: { type: sectionDef.key, subtype: sub.key }
                });
            });
        });
        return options;
    }

    function tryOpenGiveMissingItemsSelectScene() {
        if (typeof Scene_CabbyCodesGiveMissingItemsSelect === 'undefined') {
            CabbyCodes.warn(
                '[CabbyCodes] Give Missing Items: Selection scene unavailable.'
            );
            return false;
        }
        if (
            typeof SceneManager === 'undefined' ||
            typeof SceneManager.push !== 'function'
        ) {
            CabbyCodes.warn(
                '[CabbyCodes] Give Missing Items: SceneManager is not available.'
            );
            return false;
        }
        SceneManager.push(Scene_CabbyCodesGiveMissingItemsSelect);
        return true;
    }

    function triggerMaxItemsInInventoryShortcut() {
        const result = performMaxItemsInInventory();
        if (!result.success) {
            CabbyCodes.warn(
                `[CabbyCodes] ${MAX_ALL_ITEMS_LABEL} could not determine inventory limits. Load a save before pressing this option.`
            );
        }
        scheduleBulkItemShortcutReset(MAX_ALL_ITEMS_SETTING_KEY);
        return result;
    }

    CabbyCodes.registerSetting(GIVE_ALL_ITEMS_SETTING_KEY, 'Give Missing Items', {
        defaultValue: false,
        order: 45,
        formatValue: () => 'Press',
        onChange: newValue => {
            if (!newValue) {
                return;
            }
            triggerGiveMissingItemsShortcut();
        }
    });

    CabbyCodes.registerSetting(MAX_ALL_ITEMS_SETTING_KEY, MAX_ALL_ITEMS_LABEL, {
        defaultValue: false,
        order: 50,
        formatValue: () => 'Press',
        onChange: newValue => {
            if (!newValue) {
                return;
            }
            triggerMaxItemsInInventoryShortcut();
        }
    });

    const BULK_ITEM_SHORTCUT_CONFIGS = {
        [MAX_ALL_ITEMS_SYMBOL]: {
            label: MAX_ALL_ITEMS_LABEL,
            confirmText: MAX_ALL_ITEMS_CONFIRMATION_TEXT,
            confirmLabel: 'Yes, max inventory',
            cancelLabel: 'No, go back',
            execute: triggerMaxItemsInInventoryShortcut
        }
    };

    let pendingBulkItemConfirmConfig = null;

    // Register setting with formatValue to show "Press" instead of on/off
    CabbyCodes.registerSetting('itemGiver', 'Give Item', {
        defaultValue: false,
        order: 15,
        formatValue: () => 'Press'
    });

    function openBulkItemShortcutConfirmation(symbol) {
        const config = BULK_ITEM_SHORTCUT_CONFIGS[symbol];
        if (!config) {
            return false;
        }
        if (
            typeof SceneManager === 'undefined' ||
            typeof SceneManager.push !== 'function'
        ) {
            CabbyCodes.warn(
                `[CabbyCodes] ${config.label}: SceneManager is not available; cannot show confirmation.`
            );
            return false;
        }
        if (typeof Scene_CabbyCodesBulkItemConfirm === 'undefined') {
            CabbyCodes.warn(
                `[CabbyCodes] ${config.label}: Confirmation scene is unavailable.`
            );
            return false;
        }
        pendingBulkItemConfirmConfig = config;
        SceneManager.push(Scene_CabbyCodesBulkItemConfirm);
        if (typeof SceneManager.prepareNextScene === 'function') {
            SceneManager.prepareNextScene(config);
        }
        return true;
    }

    function tryOpenItemGiverScene() {
        if (typeof Scene_CabbyCodesItemGiver === 'undefined') {
            CabbyCodes.error('[CabbyCodes] Item Giver: Scene_CabbyCodesItemGiver is undefined!');
            return false;
        }
        if (
            typeof SceneManager === 'undefined' ||
            typeof SceneManager.push !== 'function'
        ) {
            CabbyCodes.error('[CabbyCodes] Item Giver: SceneManager.push is not available!');
            return false;
        }
        SceneManager.push(Scene_CabbyCodesItemGiver);
        return true;
    }

    function handleCabbyCodesOptionPress(symbol) {
        if (!symbol) {
            return false;
        }
        if (symbol === ITEM_GIVER_SETTING_SYMBOL) {
            itemGiverDebugLog('[CabbyCodes] Item Giver: Opening scene');
            return tryOpenItemGiverScene();
        }
        if (symbol === GIVE_ALL_ITEMS_SYMBOL) {
            itemGiverDebugLog('[CabbyCodes] Item Giver: Opening Give Missing Items selector');
            return tryOpenGiveMissingItemsSelectScene();
        }
        if (openBulkItemShortcutConfirmation(symbol)) {
            itemGiverDebugLog(`[CabbyCodes] Item Giver: Opened confirmation for ${symbol}`);
            return true;
        }
        return false;
    }

    //--------------------------------------------------------------------------
    // Bulk Item Confirmation Scene
    //--------------------------------------------------------------------------

    function Scene_CabbyCodesBulkItemConfirm() {
        this.initialize(...arguments);
    }

    window.Scene_CabbyCodesBulkItemConfirm = Scene_CabbyCodesBulkItemConfirm;

    Scene_CabbyCodesBulkItemConfirm.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesBulkItemConfirm.prototype.constructor = Scene_CabbyCodesBulkItemConfirm;

    Scene_CabbyCodesBulkItemConfirm.prototype.prepare = function(config) {
        this._bulkShortcutConfig = config || null;
    };

    Scene_CabbyCodesBulkItemConfirm.prototype.helpAreaHeight = function() {
        return 0;
    };

    Scene_CabbyCodesBulkItemConfirm.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.currentConfig();
        this.createInfoWindow();
        this.createCommandWindow();
    };

    Scene_CabbyCodesBulkItemConfirm.prototype.currentConfig = function() {
        if (this._bulkShortcutConfig) {
            pendingBulkItemConfirmConfig = null;
            return this._bulkShortcutConfig;
        }
        if (!this._bulkShortcutConfig && pendingBulkItemConfirmConfig) {
            this._bulkShortcutConfig = pendingBulkItemConfirmConfig;
            pendingBulkItemConfirmConfig = null;
        }
        if (!this._bulkShortcutConfig) {
            this._bulkShortcutConfig = {
                label: 'Bulk Item Shortcut',
                confirmText: 'Proceed?',
                confirmLabel: 'Yes, proceed',
                cancelLabel: 'No, go back',
                execute: null
            };
        }
        return this._bulkShortcutConfig;
    };

    Scene_CabbyCodesBulkItemConfirm.prototype.createInfoWindow = function() {
        const rect = this.infoWindowRect();
        const config = this.currentConfig();
        const uiApi = CabbyCodes.ui || {};
        const factory =
            typeof uiApi.createInfoBox === 'function'
                ? uiApi.createInfoBox
                : rectParam => new Window_CabbyCodesBulkItemInfo(rectParam);
        this._infoWindow = factory(rect, config.confirmText);
        if (this._infoWindow && typeof this._infoWindow.setText === 'function') {
            this._infoWindow.setText(config.confirmText);
        }
        this.addWindow(this._infoWindow);
    };

    Scene_CabbyCodesBulkItemConfirm.prototype.infoWindowRect = function() {
        const ww = Math.min(Graphics.boxWidth - 96, 640);
        const wx = (Graphics.boxWidth - ww) / 2;
        const wy = this.buttonAreaBottom() + 12;
        const wh = this.calcWindowHeight(4, false);
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_CabbyCodesBulkItemConfirm.prototype.createCommandWindow = function() {
        const rect = this.commandWindowRect();
        const config = this.currentConfig();
        this._commandWindow = new Window_CabbyCodesBulkItemConfirm(rect, config);
        this._commandWindow.setHandler('confirm', this.onConfirm.bind(this));
        this._commandWindow.setHandler('cancel', this.popScene.bind(this));
        this.addWindow(this._commandWindow);
    };

    Scene_CabbyCodesBulkItemConfirm.prototype.commandWindowRect = function() {
        const ww = 360;
        const wh = this.calcWindowHeight(2, true);
        const wx = (Graphics.boxWidth - ww) / 2;
        const spacing = 18;
        const baseY = this._infoWindow
            ? this._infoWindow.y + this._infoWindow.height + spacing
            : this.buttonAreaBottom() + spacing;
        const maxY = Graphics.boxHeight - wh - spacing;
        const wy = Math.min(baseY, maxY);
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_CabbyCodesBulkItemConfirm.prototype.onConfirm = function() {
        const config = this.currentConfig();
        try {
            if (typeof config.execute === 'function') {
                config.execute();
            }
        } catch (error) {
            const label = config.label || 'Bulk Item Shortcut';
            CabbyCodes.error(
                `[CabbyCodes] ${label}: Confirmation failed: ${error?.message || error}`
            );
        }
        SceneManager.pop();
    };

    //--------------------------------------------------------------------------
    // Confirmation Command Window
    //--------------------------------------------------------------------------

    function Window_CabbyCodesBulkItemConfirm() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesBulkItemConfirm = Window_CabbyCodesBulkItemConfirm;

    Window_CabbyCodesBulkItemConfirm.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesBulkItemConfirm.prototype.constructor = Window_CabbyCodesBulkItemConfirm;

    Window_CabbyCodesBulkItemConfirm.prototype.initialize = function(rect, config) {
        this._bulkShortcutConfig = config || null;
        Window_Command.prototype.initialize.call(this, rect);
    };

    Window_CabbyCodesBulkItemConfirm.prototype.makeCommandList = function() {
        const confirmLabel =
            (this._bulkShortcutConfig && this._bulkShortcutConfig.confirmLabel) ||
            'Yes, proceed';
        const cancelLabel =
            (this._bulkShortcutConfig && this._bulkShortcutConfig.cancelLabel) ||
            'No, go back';
        this.addCommand(confirmLabel, 'confirm');
        this.addCommand(cancelLabel, 'cancel');
    };

    //--------------------------------------------------------------------------
    // Fallback Info Window
    //--------------------------------------------------------------------------

    function Window_CabbyCodesBulkItemInfo() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesBulkItemInfo = Window_CabbyCodesBulkItemInfo;

    Window_CabbyCodesBulkItemInfo.prototype = Object.create(Window_Base.prototype);
    Window_CabbyCodesBulkItemInfo.prototype.constructor = Window_CabbyCodesBulkItemInfo;

    Window_CabbyCodesBulkItemInfo.prototype.initialize = function(rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this._text = '';
    };

    Window_CabbyCodesBulkItemInfo.prototype.setText = function(text) {
        const normalized = String(text || '');
        if (this._text === normalized) {
            return;
        }
        this._text = normalized;
        this.refresh();
    };

    Window_CabbyCodesBulkItemInfo.prototype.refresh = function() {
        if (!this.contents) {
            this.createContents();
        }
        this.contents.clear();
        const lines = String(this._text || '').split(/\r?\n/);
        const maxWidth = this.contentsWidth();
        let y = 0;
        lines.forEach(line => {
            this.drawText(line, 0, y, maxWidth);
            y += this.lineHeight();
        });
    };

    //--------------------------------------------------------------------------
    // Give Missing Items Selection Scene
    //--------------------------------------------------------------------------

    const GIVE_MISSING_ITEMS_SELECT_INFO_TEXT =
        'Give Missing Items\n' +
        'Pick a category. One copy of each missing non-key item in that\n' +
        'category will be added. Press Cancel to leave.';
    const GIVE_MISSING_ITEMS_SELECT_INFO_LINES = 3;
    const GIVE_MISSING_ITEMS_SELECT_VISIBLE_ROWS = 10;

    function Scene_CabbyCodesGiveMissingItemsSelect() {
        this.initialize(...arguments);
    }

    window.Scene_CabbyCodesGiveMissingItemsSelect = Scene_CabbyCodesGiveMissingItemsSelect;

    Scene_CabbyCodesGiveMissingItemsSelect.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesGiveMissingItemsSelect.prototype.constructor = Scene_CabbyCodesGiveMissingItemsSelect;

    Scene_CabbyCodesGiveMissingItemsSelect.prototype.helpAreaHeight = function() {
        return 0;
    };

    Scene_CabbyCodesGiveMissingItemsSelect.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createInfoWindow();
        this.createCommandWindow();
    };

    Scene_CabbyCodesGiveMissingItemsSelect.prototype.createInfoWindow = function() {
        const ww = Math.min(Graphics.boxWidth - 96, 640);
        const wx = (Graphics.boxWidth - ww) / 2;
        const wy = this.buttonAreaBottom() + 12;
        const wh = this.calcWindowHeight(GIVE_MISSING_ITEMS_SELECT_INFO_LINES, false);
        const rect = new Rectangle(wx, wy, ww, wh);
        this._infoWindow = new Window_CabbyCodesBulkItemInfo(rect);
        this._infoWindow.setText(GIVE_MISSING_ITEMS_SELECT_INFO_TEXT);
        this.addWindow(this._infoWindow);
    };

    Scene_CabbyCodesGiveMissingItemsSelect.prototype.createCommandWindow = function() {
        const options = buildGiveMissingItemsMenuOptions();
        const ww = 360;
        const spacing = 18;
        const wy = this._infoWindow
            ? this._infoWindow.y + this._infoWindow.height + spacing
            : this.buttonAreaBottom() + spacing;
        const wx = (Graphics.boxWidth - ww) / 2;
        const optionCount = Math.max(options.length, 1);
        const oneRow = this.calcWindowHeight(1, true);
        const twoRows = this.calcWindowHeight(2, true);
        const rowExtra = Math.max(0, twoRows - oneRow);
        const frame = Math.max(0, oneRow - rowExtra);
        const availableHeight = Math.max(oneRow, Graphics.boxHeight - wy - spacing);
        const fitRows = Math.max(1, Math.floor((availableHeight - frame) / Math.max(rowExtra, 1)));
        const visibleRows = Math.min(
            optionCount,
            GIVE_MISSING_ITEMS_SELECT_VISIBLE_ROWS,
            fitRows
        );
        const wh = this.calcWindowHeight(visibleRows, true);
        const rect = new Rectangle(wx, wy, ww, wh);
        this._commandWindow = new Window_CabbyCodesGiveMissingItemsSelect(rect, options);
        this._commandWindow.setHandler('select', this.onSelect.bind(this));
        this._commandWindow.setHandler('cancel', this.popScene.bind(this));
        this.addWindow(this._commandWindow);
        this._commandWindow.select(0);
        this._commandWindow.activate();
    };

    Scene_CabbyCodesGiveMissingItemsSelect.prototype.onSelect = function() {
        const ext = this._commandWindow ? this._commandWindow.currentExt() : null;
        if (!ext) {
            if (this._commandWindow) {
                this._commandWindow.activate();
            }
            return;
        }
        try {
            performGiveMissingItems(ext.filter, ext.label);
        } catch (error) {
            CabbyCodes.error(
                '[CabbyCodes] Give Missing Items: Selection failed: ' +
                    (error?.message || error)
            );
        }
        SceneManager.pop();
    };

    function Window_CabbyCodesGiveMissingItemsSelect() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesGiveMissingItemsSelect = Window_CabbyCodesGiveMissingItemsSelect;

    Window_CabbyCodesGiveMissingItemsSelect.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesGiveMissingItemsSelect.prototype.constructor = Window_CabbyCodesGiveMissingItemsSelect;

    Window_CabbyCodesGiveMissingItemsSelect.prototype.initialize = function(rect, options) {
        this._giveMissingOptions = Array.isArray(options) ? options : [];
        Window_Command.prototype.initialize.call(this, rect);
    };

    Window_CabbyCodesGiveMissingItemsSelect.prototype.makeCommandList = function() {
        const opts = this._giveMissingOptions || [];
        if (opts.length === 0) {
            this.addCommand('All', 'select', true, { id: 'all', label: 'All', filter: null });
            return;
        }
        opts.forEach(opt => {
            this.addCommand(opt.label, 'select', true, opt);
        });
    };

    // Hook into Window_Options to open scene when setting is selected
    // This needs to wrap the settings.js hook to intercept before toggle
    function setupProcessOkHook() {
        try {
            if (typeof Window_Options === 'undefined') {
                itemGiverDebugLog('[CabbyCodes] Item Giver: Window_Options is undefined');
                return false;
            }
            if (Window_Options.prototype._cabbycodesItemGiverProcessOkHookInstalled) {
                itemGiverDebugLog('[CabbyCodes] Item Giver: Hook already installed');
                return true;
            }
            if (!Window_Options.prototype.processOk) {
                itemGiverDebugLog('[CabbyCodes] Item Giver: Window_Options.prototype.processOk is undefined');
                return false;
            }
            const previousProcessOk = Window_Options.prototype.processOk;
            const hookType = typeof previousProcessOk;
            itemGiverDebugLog('[CabbyCodes] Item Giver: Stored processOk hook, type: ' + hookType);
            if (hookType !== 'function' && hookType !== 'undefined') {
                CabbyCodes.warn('[CabbyCodes] Item Giver: processOk is not a function, type:', hookType);
            }
            
            Window_Options.prototype.processOk = function() {
                try {
                    itemGiverDebugLog('[CabbyCodes] Item Giver: processOk called');
                    const index = this.index();
                    itemGiverDebugLog('[CabbyCodes] Item Giver: index = ' + String(index));
                    const symbol = this.commandSymbol(index);
                    itemGiverDebugLog('[CabbyCodes] Item Giver: symbol = ' + String(symbol || '(empty)'));
                    if (handleCabbyCodesOptionPress(symbol)) {
                        itemGiverDebugLog('[CabbyCodes] Item Giver: Handled CabbyCodes press');
                        return;
                    }
                    if (typeof previousProcessOk === 'function') {
                        itemGiverDebugLog('[CabbyCodes] Item Giver: Calling previous hook');
                        previousProcessOk.call(this);
                    } else {
                        CabbyCodes.warn('[CabbyCodes] Item Giver: Previous hook is not a function, type:', typeof previousProcessOk);
                    }
                } catch (e) {
                    CabbyCodes.error('[CabbyCodes] Item Giver: Error in processOk hook:', e?.message || e);
                    CabbyCodes.error('[CabbyCodes] Item Giver: Stack:', e?.stack);
                    if (typeof previousProcessOk === 'function') {
                        try {
                            previousProcessOk.call(this);
                        } catch (e2) {
                            CabbyCodes.error('[CabbyCodes] Item Giver: Error in fallback hook:', e2?.message || e2);
                        }
                    }
                }
            };
            Window_Options.prototype._cabbycodesItemGiverProcessOkHookInstalled = true;
            itemGiverDebugLog('[CabbyCodes] Item Giver: Hook installed successfully');
            return true;
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error setting up hook:', e?.message || e, e?.stack);
            return false;
        }
    }
    
    // Try to set up the hook immediately
    if (!setupProcessOkHook()) {
        itemGiverDebugLog('[CabbyCodes] Item Giver: Window_Options not ready, waiting...');
        // If Window_Options isn't loaded yet, wait for it
        const checkWindowOptions = setInterval(() => {
            if (setupProcessOkHook()) {
                clearInterval(checkWindowOptions);
            }
        }, 10);
        setTimeout(() => {
            clearInterval(checkWindowOptions);
            if (
                !Window_Options ||
                !Window_Options.prototype._cabbycodesItemGiverProcessOkHookInstalled
            ) {
                CabbyCodes.error('[CabbyCodes] Item Giver: Failed to set up hook after 5 seconds');
            }
        }, 5000);
    }

    itemGiverDebugLog('[CabbyCodes] Item Giver module loaded');
})();

