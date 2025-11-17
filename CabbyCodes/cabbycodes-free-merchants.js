//=============================================================================
// CabbyCodes Free Merchants
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Free Merchants - Sets shop item prices to zero.
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that drops the price of every merchant item to
 * zero. When enabled, all shop interfaces display a cost of 0 and purchases no
 * longer deduct gold.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Free Merchants requires CabbyCodes core.');
        return;
    }

    const settingKey = 'freeMerchants';
    const isFeatureEnabled = () => CabbyCodes.getSetting(settingKey, false);

    const callOriginal = typeof CabbyCodes.callOriginal === 'function'
        ? CabbyCodes.callOriginal
        : (target, functionName, context, args) => {
              const originals = target._cabbycodesOriginals;
              if (originals && typeof originals[functionName] === 'function') {
                  return originals[functionName].apply(context, args);
              }
              return undefined;
          };

    CabbyCodes.registerSetting(
        settingKey,
        'Free Merchants',
        {
            defaultValue: false,
            order: 63
        },
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Free merchants ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    CabbyCodes.override(
        Window_ShopBuy.prototype,
        'price',
        function(item) {
            if (isFeatureEnabled() && item) {
                return 0;
            }

            return callOriginal(Window_ShopBuy.prototype, 'price', this, [item]);
        }
    );

    CabbyCodes.log('[CabbyCodes] Free Merchants module loaded');
})();


