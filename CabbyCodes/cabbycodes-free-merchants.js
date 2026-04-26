//=============================================================================
// CabbyCodes Free Merchants
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Free Merchants - Sets shop item prices to zero.
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that drops the price of every merchant item to
 * zero. When enabled, standard shop interfaces display a cost of 0, the
 * custom event-driven "BuyItemTable" purchase flow (Eugene's shop) no longer
 * deducts gold on the Buy choice, and Mutt's special-inventory shop on
 * Map056 (which prices via common event 291 / var 7) is also free.
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
            order: 90
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

    // Eugene's shop (Map132) bypasses Window_ShopBuy entirely: each shelf
    // event calls common event 46 (BuyItemTable), which runs its own
    // dialog/choice UI. The final buy price lives in var 487 and drives
    // both the rendered dialog ("The price is $\V[487]") and the gold
    // deduction at command125. Tag child interpreters entering CE 46 so
    // the nested overrides can scope to that flow.
    const BUY_ITEM_TABLE_CE = 46;
    const PRICE_VARIABLE_ID = 487;

    // Mutt's special shop (Map056) builds its own dialog/choice flow per
    // shelf: the parent event sets var 7 to the base price, calls common
    // event 291 (MuttSpecialPrice) to apply HARDMODE/repeat-buy/haggle
    // multipliers, then renders "$\V[7]" and runs command125 [1, 1, 7]
    // to deduct gold. Zeroing var 7 inside CE 291 makes both the dialog
    // and the deduction read 0.
    const MUTT_SPECIAL_PRICE_CE = 291;
    const MUTT_PRICE_VARIABLE_ID = 7;

    CabbyCodes.override(
        Game_Interpreter.prototype,
        'command117',
        function(parameters) {
            const result = callOriginal(Game_Interpreter.prototype, 'command117', this, [parameters]);

            const ceId = Number(Array.isArray(parameters) ? parameters[0] : NaN);
            if (Number.isFinite(ceId) && this._childInterpreter) {
                if (ceId === BUY_ITEM_TABLE_CE || this._cabbycodesInBuyItemTable) {
                    this._childInterpreter._cabbycodesInBuyItemTable = true;
                }
                if (ceId === MUTT_SPECIAL_PRICE_CE) {
                    this._childInterpreter._cabbycodesInMuttSpecialPrice = true;
                }
            }

            return result;
        }
    );

    // Zero out the active shop's price variable after every command122
    // while a relevant pricing CE is running. Eugene's flow only writes
    // var 487 via command122, so range-checking is enough. Mutt's CE 291
    // writes var 7 once via command122 (the HARDMODE +20) and then via
    // script-eval (multiplications) — forcing var 7 = 0 after every
    // command122 makes the subsequent `var7 * X` evals stay at 0, and
    // Math.floor(0) = 0 so the final value sticks.
    CabbyCodes.override(
        Game_Interpreter.prototype,
        'command122',
        function(params) {
            const result = callOriginal(Game_Interpreter.prototype, 'command122', this, [params]);

            if (
                isFeatureEnabled() &&
                Array.isArray(params) &&
                typeof $gameVariables !== 'undefined' &&
                $gameVariables
            ) {
                if (this._cabbycodesInBuyItemTable) {
                    const startId = Number(params[0]);
                    const endId = Number(params[1]);
                    if (
                        Number.isFinite(startId) &&
                        Number.isFinite(endId) &&
                        startId <= PRICE_VARIABLE_ID &&
                        PRICE_VARIABLE_ID <= endId
                    ) {
                        $gameVariables.setValue(PRICE_VARIABLE_ID, 0);
                    }
                }

                if (this._cabbycodesInMuttSpecialPrice) {
                    $gameVariables.setValue(MUTT_PRICE_VARIABLE_ID, 0);
                }
            }

            return result;
        }
    );

    CabbyCodes.override(
        Game_Interpreter.prototype,
        'command125',
        function(params) {
            if (
                isFeatureEnabled() &&
                this._cabbycodesInBuyItemTable &&
                Array.isArray(params) &&
                Number(params[0]) === 1 // 0 = Increase, 1 = Decrease
            ) {
                return true;
            }

            return callOriginal(Game_Interpreter.prototype, 'command125', this, [params]);
        }
    );

    CabbyCodes.log('[CabbyCodes] Free Merchants module loaded');
})();


