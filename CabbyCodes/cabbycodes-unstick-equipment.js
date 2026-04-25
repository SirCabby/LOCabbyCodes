//=============================================================================
// CabbyCodes Unstick Equipment
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Unstick Equipment - Allows removing class-locked or state-sealed equipment from the standard Equip menu.
 * @author CabbyCodes
 * @help
 * Adds a toggle that overrides Game_Actor.prototype.isEquipChangeOk to return
 * true while enabled, so every slot in the vanilla Equip menu becomes
 * selectable. Picking the blank "(no item)" entry routes through the normal
 * changeEquip -> tradeItemWithParty path, which puts the removed item back in
 * the party's inventory.
 *
 * Only affects party actors, since the Equip menu only exposes party members.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Unstick Equipment requires CabbyCodes core.');
        return;
    }

    const SETTING_KEY = 'unstickEquipment';

    CabbyCodes.registerSetting(
        SETTING_KEY,
        'Unstick Equipment',
        {
            defaultValue: false,
            order: 78
        },
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Unstick Equipment ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    const isEnabled = () => CabbyCodes.getSetting(SETTING_KEY, false);

    CabbyCodes.override(Game_Actor.prototype, 'isEquipChangeOk', function (slotId) {
        if (isEnabled()) {
            return true;
        }
        return CabbyCodes.callOriginal(Game_Actor.prototype, 'isEquipChangeOk', this, arguments);
    });

    CabbyCodes.log('[CabbyCodes] Unstick Equipment module loaded');
})();
