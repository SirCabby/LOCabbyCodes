//=============================================================================
// CabbyCodes Locked Doors
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Locked Doors - Backs the "Locked Doors" submenu of Story Flags.
 * @author CabbyCodes
 * @help
 * Surfaces a "Locked Doors" sub-section inside the Story Flags categories
 * picker. Story Flags reaches in via CabbyCodes.openLockedDoorsScene().
 *
 * The scene shows a scrollable list of curated, story-meaningful doors.
 * Each row shows the door's friendly label and its current Locked /
 * Unlocked state; pressing OK toggles it.
 *
 * State writes go through `$gameVariables.setValue` / `$gameSwitches.setValue`
 * with a freeze-time `exemptFromRestore` token held across the write so the
 * change isn't snapped back by the restore loop. None of the curated door IDs
 * are currently in the freeze-time set, but the token is cheap insurance and
 * matches the prevailing pattern in story-flags.
 *
 * Door polarity (which value means "locked") was verified per-entry against
 * each event's page conditions in the vanilla map data — many switches named
 * like "F1StairsLock" are set ON when the lock is *picked* (i.e. ON = unlocked),
 * which is the opposite of what the name suggests.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Locked Doors requires CabbyCodes core.');
        return;
    }

    const LOG_PREFIX = '[CabbyCodes][LockedDoors]';

    const PICKER_WIDTH = 480;
    const PICKER_SPACING = 12;
    const PICKER_MAX_ROWS = 12;

    //----------------------------------------------------------------------
    // Curated door list
    //----------------------------------------------------------------------
    //
    // Each entry: { id, label, kind: 'variable'|'switch', varId|switchId,
    //               lockedValue, unlockedValue }
    //
    // Polarity was determined by reading each door event's pages in
    // `game_files/data/Map*.json`. The convention across these doors:
    //   page 0 (no condition) plays "Door_CantOpen" + "It's locked." text.
    //   a higher page (gated on the switch/var) plays the normal open SE and
    //   transfers the player.
    // So for most entries, switch ON = UNLOCKED (despite names like "Lock").
    // The Bedroom Door (var 299 `bedroomDoorLocked`) is the lone exception
    // where the natural-language polarity matches the data.
    //
    // Note: a few doors layer additional conditions (e.g. Security Door,
    // Elevator Door, and the numbered electronic puzzle doors also require
    // switch 21 `havePower`). Toggling these unlocked while power is off
    // still shows the in-game "no power" / "electronic" message; this is
    // honest behaviour, not a bug in the cheat.
    //
    // Doors that have an in-game key prompt ("Use the Basement Key?", "Use
    // the Padlock Key?") are intentionally NOT included — the player can
    // already unlock those naturally by carrying the key. The list below
    // focuses on doors with no key path: one-way doors locked from the
    // unreachable side, electronic / number-puzzle locks whose code is
    // hidden in another room, story-locked doors, and shortcut valves.

    const DOORS = [
        // ---- Player's apartment ----

        // Apartment 22 bedroom. Var 299 is set to 1 by the night-cycle / story
        // event that locks the player in; clearing it lets the player walk
        // out at any time of day.
        // Verified: Map003 ev7 'DoorBedroom' page1 gated on var299 == 1.
        { id: 'bedroomDoor',         label: 'Bedroom Door',                kind: 'variable', varId: 299, lockedValue: 1, unlockedValue: 0 },

        // ---- Stairwells and building access (one-way back doors) ----

        // Locked from the other side; sw88 ON = unlocked.
        // Verified: Map026 ev1/ev2 'StairDoorL/R' page1 gated on sw88.
        { id: 'f1StairsDoor',        label: 'Floor 1 Stairs Door',         kind: 'switch',   switchId: 88,  lockedValue: 0, unlockedValue: 1 },
        // Verified: Map048 ev1 / Map075 ev1 'StairDoorR' page1 gated on sw111.
        { id: 'basementBackDoor',    label: 'Basement Back Door',          kind: 'switch',   switchId: 111, lockedValue: 0, unlockedValue: 1 },
        // The garage's outside-facing tile is one-way ("locked from the
        // other side"); the inside tile has its own panel-unlock interaction.
        // Verified: Map050 ev1 'Door' page1 / Map086 ev2 'StairDoorR' page1
        // gated on sw113.
        { id: 'garageDoor',          label: 'Garage Door',                 kind: 'switch',   switchId: 113, lockedValue: 0, unlockedValue: 1 },
        // Multiple elevator-door instances across floors all gate on sw115.
        // Page 3 on the Floor 3 instance also requires sw 21 (havePower);
        // unlocking with no power still shows the "elevator isn't working"
        // message.
        // Verified: Map006 ev5 'DoorElevator' page3 gated on sw115 & sw21;
        // Map007 ev12, Map047 ev12, Map050 ev3 follow the same pattern.
        { id: 'elevatorDoor',        label: 'Elevator Door',               kind: 'switch',   switchId: 115, lockedValue: 0, unlockedValue: 1 },
        // Locked from the other side ("door to the shipping and receiving
        // room... the other side").
        // Verified: Map071 ev3 'DoorOffice' page1 gated on sw116.
        { id: 'mailroomDoor',        label: 'Mailroom / Office Door',      kind: 'switch',   switchId: 116, lockedValue: 0, unlockedValue: 1 },
        // Cafe / shop kitchen back door, locked from the other side.
        // Verified: Map047 ev6 'DoorCafeKitchen' page1 gated on sw159.
        { id: 'cafeBackDoor',        label: 'Cafe Kitchen Back Door',      kind: 'switch',   switchId: 159, lockedValue: 0, unlockedValue: 1 },
        // Fungus Path back door, locked from the other side.
        // Verified: Map188 ev16 'StairDoorR' page1 gated on sw519.
        { id: 'fungusPathBackDoor',  label: 'Fungus Path Back Door',       kind: 'switch',   switchId: 519, lockedValue: 0, unlockedValue: 1 },
        // Apt 30 Taxidermy storage room, locked from the other side.
        // Verified: Map270 ev1 'DoorStorage' page1 gated on sw694.
        { id: 'taxidermyStorage',    label: 'Taxidermy Storage Door',      kind: 'switch',   switchId: 694, lockedValue: 0, unlockedValue: 1 },

        // ---- Numbered electronic / puzzle locks (no key item) ----

        // Security door at the basement entrance, electronically locked with
        // an "equal sign" hint. Also requires sw 21 (havePower).
        // Verified: Map048 ev2 'SecurityDoor' page1 gated on sw112 & sw21.
        { id: 'securityDoor',        label: 'Security Door',               kind: 'switch',   switchId: 112, lockedValue: 0, unlockedValue: 1 },
        // Inner Security stair door, electronic lock with number "18".
        // Verified: Map049 ev1 'StairDoorR' page1 gated on sw250.
        { id: 'innerSecurityDoor',   label: 'Inner Security Door',         kind: 'switch',   switchId: 250, lockedValue: 0, unlockedValue: 1 },
        // Office Number 29 — electronic lock.
        // Verified: Map065 ev3 page1 gated on sw251.
        { id: 'officeDoor29',        label: 'Office Door (#29)',           kind: 'switch',   switchId: 251, lockedValue: 0, unlockedValue: 1 },
        // Inner office Number 15 — electronic lock.
        // Verified: Map068 ev7 page1 gated on sw252.
        { id: 'officeDoor15',        label: 'Inner Office Door (#15)',     kind: 'switch',   switchId: 252, lockedValue: 0, unlockedValue: 1 },
        // Mailroom Saturn-symbol electronic lock — alternate path to the
        // mailroom area, distinct from the one-way Mailroom / Office Door.
        // Verified: Map071 ev2 'DoorOffice' page1 gated on sw253.
        { id: 'mailroomSaturnDoor',  label: 'Mailroom Door (Saturn)',      kind: 'switch',   switchId: 253, lockedValue: 0, unlockedValue: 1 },
        // Mars Room puzzle door (Floor 1 Door10), number "1" etched.
        // Requires sw 21 (havePower).
        // Verified: Map092 ev10 'Door10' page1 gated on sw99 & sw21.
        { id: 'marsRoomDoor',        label: 'Mars Room Door',              kind: 'switch',   switchId: 99,  lockedValue: 0, unlockedValue: 1 },
        // Ground-floor / G-Stairs interconnect, gated on the Mars/Earth
        // socket puzzle solution.
        // Verified: Map047 ev15/ev16 'StairDoorL/R' page1 gated on sw100;
        // Map027 GStairs StairDoorL/R follow the same pattern.
        { id: 'groundStairsDoor',    label: 'Ground Floor Stairs',         kind: 'switch',   switchId: 100, lockedValue: 0, unlockedValue: 1 },
        // Basement storage doors, electronic locks with numbers "16" / "5".
        // Both require sw 21 (havePower).
        // Verified: Map079 ev2 page1 gated on sw254 & sw21; ev5 on sw255 & sw21.
        { id: 'storageDoorNeptune',  label: 'Storage Door (#16)',          kind: 'switch',   switchId: 254, lockedValue: 0, unlockedValue: 1 },
        { id: 'storageDoorPluto',    label: 'Storage Door (#5)',           kind: 'switch',   switchId: 255, lockedValue: 0, unlockedValue: 1 },
        // Planetarium puzzle pair: outer door from the apartment hallway,
        // and inner door inside the planetarium itself.
        // Verified: Map357 ev1 'EV001' page1 gated on sw993 (outer);
        // Map345 ev31 'EV031' page1 gated on sw699 (inner).
        { id: 'planetariumOuter',    label: 'Planetarium Outer Door',      kind: 'switch',   switchId: 993, lockedValue: 0, unlockedValue: 1 },
        { id: 'planetariumInner',    label: 'Planetarium Inner Door',      kind: 'switch',   switchId: 699, lockedValue: 0, unlockedValue: 1 },

        // ---- One-way / story doors ----

        // Boiler Room storage door, locked from the other side.
        // Verified: Map079 ev6 'DoorStore' page1 gated on sw457.
        { id: 'boilerRoomDoor',      label: 'Boiler Room Door',            kind: 'switch',   switchId: 457, lockedValue: 0, unlockedValue: 1 },
        // Pit-area stair door (Basement Sideroom), "seems stuck".
        // Verified: Map272 ev10 'StairDoorR' page1 gated on sw1063.
        { id: 'pitDoor',             label: 'Pit Door',                    kind: 'switch',   switchId: 1063, lockedValue: 0, unlockedValue: 1 },
        // Landlord's apartment door, gated on the bus-monsters story-progress
        // variable; passes when var362 reaches 4 (story-progress threshold).
        // Verified: Map047 ev9 'LandlordsRoom' page1 gated on var362 >= 4.
        { id: 'landlordAptDoor',     label: 'Landlord\'s Apartment Door',  kind: 'variable', varId: 362, lockedValue: 0, unlockedValue: 4 },
        // Flooded Apt block-4 shortcut. Page 0 = "The valve won't turn. It's
        // stuck."; sw464 ON unlocks it and runs CE114 to open the path.
        // Verified: Map159 ev8 'DoorExit' page1 gated on sw464.
        { id: 'floodedAptShortcut',  label: 'Flooded Apt Shortcut Valve',  kind: 'switch',   switchId: 464, lockedValue: 0, unlockedValue: 1 },
        // Power-room door at Map050. Three-page logic: power off = pass
        // through (default); power on without sw987 = locked ("electric
        // room"); sw987 ON = unlocked. The cheat only matters when power is
        // already on.
        // Verified: Map050 ev2 'StairDoorR' page2 gated on sw987.
        { id: 'powerRoomDoor',       label: 'Power Room Door',             kind: 'switch',   switchId: 987, lockedValue: 0, unlockedValue: 1 },
        // Apartment 24 (Eugene's shop). The shop has a separate "temporarily
        // closed" override (sw 331 `tempCloseEugene`) that takes precedence
        // when ON; it is intentionally not exposed here because it's an
        // event-driven state, not a player-facing lock.
        // Verified: Map007 ev20 'DoorEugene' page1 gated on sw74.
        { id: 'eugenesShop',         label: 'Eugene\'s Shop Door',         kind: 'switch',   switchId: 74,  lockedValue: 0, unlockedValue: 1 },

        // ---- Meat World shortcut squeezes ----
        //
        // Each of these is a flesh-world hole that the natural game gates
        // behind a "Squeeze through? [Yes/No]" choice on first encounter,
        // setting the named shortcut switch ON when the player squeezes
        // through. While ON, future visits skip the prompt and walk straight
        // through. Toggling here pre-opens (or re-locks) each shortcut.
        // Verified by reading each event's page list:
        //   Map388 ev11 'EV011' page1 gated on sw1130 (FleshStairs1 stairway)
        //   Map384 ev12 'EV012' page1 gated on sw1131 (Flesh1 rat lair)
        //   Map407 ev9  'EV009' page1 gated on sw1127 (Flesh36 TV stairway)
        //   Map428 ev5  'EV005' page1 gated on sw1128 (FleshLaundromat)
        //   Map427 ev9  'EV009' page1 gated on sw1129 (FleshMutt storage)
        { id: 'fleshStairwayShortcut',  label: 'Flesh Stairway Shortcut',     kind: 'switch', switchId: 1130, lockedValue: 0, unlockedValue: 1 },
        { id: 'fleshRatLairShortcut',   label: 'Flesh Rat Lair Shortcut',     kind: 'switch', switchId: 1131, lockedValue: 0, unlockedValue: 1 },
        { id: 'fleshTvShortcut',        label: 'Flesh TV Shortcut',           kind: 'switch', switchId: 1127, lockedValue: 0, unlockedValue: 1 },
        { id: 'fleshLaundromatShortcut',label: 'Flesh Laundromat Shortcut',   kind: 'switch', switchId: 1128, lockedValue: 0, unlockedValue: 1 },
        { id: 'fleshMuttStorageShortcut',label:'Flesh Mutt Storage Shortcut', kind: 'switch', switchId: 1129, lockedValue: 0, unlockedValue: 1 }
    ];

    //----------------------------------------------------------------------
    // Session / state helpers
    //----------------------------------------------------------------------

    function isSessionReady() {
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return false;
        }
        if (typeof $gameSwitches === 'undefined' || !$gameSwitches) {
            return false;
        }
        if (typeof CabbyCodes.isGameSessionActive === 'function' && !CabbyCodes.isGameSessionActive()) {
            return false;
        }
        return true;
    }

    function readDoorRaw(door) {
        if (door.kind === 'switch') {
            return $gameSwitches.value(door.switchId) ? 1 : 0;
        }
        const raw = Number($gameVariables.value(door.varId));
        return Number.isFinite(raw) ? raw : 0;
    }

    function isDoorLocked(door) {
        return readDoorRaw(door) === door.lockedValue;
    }

    function doorStateLabel(door) {
        return isDoorLocked(door) ? 'Locked' : 'Unlocked';
    }

    // Returns true if the scene was pushed; false if blocked. Story Flags
    // checks the return value to decide whether to re-activate its category
    // list (so the user is not stranded with no input focus when the push is
    // refused).
    function openLockedDoorsScene() {
        if (!isSessionReady()) {
            CabbyCodes.warn(`${LOG_PREFIX} Picker blocked: no active session.`);
            SoundManager.playBuzzer();
            return false;
        }
        if (typeof SceneManager === 'undefined' || typeof Scene_CabbyCodesLockedDoors === 'undefined') {
            CabbyCodes.warn(`${LOG_PREFIX} SceneManager or scene unavailable.`);
            return false;
        }
        SceneManager.push(Scene_CabbyCodesLockedDoors);
        return true;
    }

    //----------------------------------------------------------------------
    // Apply path
    //----------------------------------------------------------------------

    function toggleDoor(door) {
        if (!isSessionReady()) {
            return false;
        }
        const wasLocked = isDoorLocked(door);
        const newValue = wasLocked ? door.unlockedValue : door.lockedValue;
        const api = CabbyCodes.freezeTime;
        const exempt = (door.kind === 'switch')
            ? { switches: [door.switchId] }
            : { variables: [door.varId] };
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore(exempt)
            : { release: () => {} };
        try {
            if (door.kind === 'switch') {
                $gameSwitches.setValue(door.switchId, Boolean(newValue));
            } else {
                $gameVariables.setValue(door.varId, newValue);
            }
            const readBack = readDoorRaw(door);
            CabbyCodes.warn(`${LOG_PREFIX} ${door.label}: ${wasLocked ? 'Locked' : 'Unlocked'} -> ${isDoorLocked(door) ? 'Locked' : 'Unlocked'}. Read-back raw: ${readBack}.`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Toggle failed for ${door.label}: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    //----------------------------------------------------------------------
    // Layout helper
    //----------------------------------------------------------------------

    function pickerLayoutFor(scene, rowCount) {
        const width = Math.min(PICKER_WIDTH, Graphics.boxWidth - 32);
        const helpHeight = scene.calcWindowHeight(2, false);
        const listRows = Math.min(Math.max(rowCount, 1), PICKER_MAX_ROWS);
        const listHeight = scene.calcWindowHeight(listRows, true);
        const totalHeight = helpHeight + PICKER_SPACING + listHeight;
        const x = Math.max(0, Math.floor((Graphics.boxWidth - width) / 2));
        const baseY = Math.max(0, Math.floor((Graphics.boxHeight - totalHeight) / 2));
        return { x, baseY, width, helpHeight, listHeight };
    }

    //----------------------------------------------------------------------
    // Scene_CabbyCodesLockedDoors
    //----------------------------------------------------------------------

    function Scene_CabbyCodesLockedDoors() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesLockedDoors.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesLockedDoors.prototype.constructor = Scene_CabbyCodesLockedDoors;

    Scene_CabbyCodesLockedDoors.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createListWindow();
    };

    Scene_CabbyCodesLockedDoors.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesLockedDoors.prototype.createHelpWindow = function() {
        const layout = pickerLayoutFor(this, DOORS.length);
        const rect = new Rectangle(layout.x, layout.baseY, layout.width, layout.helpHeight);
        this._helpWindow = new Window_Help(rect);
        this._helpWindow.setText('Locked Doors\nPress to toggle a door.');
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesLockedDoors.prototype.createListWindow = function() {
        const layout = pickerLayoutFor(this, DOORS.length);
        const rect = new Rectangle(
            layout.x,
            layout.baseY + layout.helpHeight + PICKER_SPACING,
            layout.width,
            layout.listHeight
        );
        this._listWindow = new Window_CabbyCodesLockedDoorsList(rect);
        this._listWindow.setDoors(DOORS);
        this._listWindow.setHandler('ok', this.onDoorOk.bind(this));
        this._listWindow.setHandler('cancel', this.onListCancel.bind(this));
        this.addWindow(this._listWindow);
        this._listWindow.select(0);
        this._listWindow.activate();
    };

    Scene_CabbyCodesLockedDoors.prototype.onDoorOk = function() {
        const door = this._listWindow.currentDoor();
        if (!door) {
            this._listWindow.activate();
            return;
        }
        toggleDoor(door);
        this._listWindow.refresh();
        this._listWindow.activate();
    };

    Scene_CabbyCodesLockedDoors.prototype.onListCancel = function() {
        SceneManager.pop();
    };

    window.Scene_CabbyCodesLockedDoors = Scene_CabbyCodesLockedDoors;

    //----------------------------------------------------------------------
    // Window_CabbyCodesLockedDoorsList
    //----------------------------------------------------------------------

    function Window_CabbyCodesLockedDoorsList() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesLockedDoorsList.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesLockedDoorsList.prototype.constructor = Window_CabbyCodesLockedDoorsList;

    Window_CabbyCodesLockedDoorsList.prototype.initialize = function(rect) {
        this._doors = [];
        Window_Command.prototype.initialize.call(this, rect);
    };

    Window_CabbyCodesLockedDoorsList.prototype.setDoors = function(doors) {
        this._doors = Array.isArray(doors) ? doors : [];
        this.refresh();
    };

    Window_CabbyCodesLockedDoorsList.prototype.numVisibleRows = function() {
        return Math.min(PICKER_MAX_ROWS, this.maxItems() || 1);
    };

    Window_CabbyCodesLockedDoorsList.prototype.makeCommandList = function() {
        (this._doors || []).forEach((door, index) => {
            this.addCommand(door.label, `door_${door.id}`, true, index);
        });
    };

    Window_CabbyCodesLockedDoorsList.prototype.currentDoor = function() {
        const index = this.currentExt();
        if (typeof index !== 'number') {
            return null;
        }
        return this._doors[index] || null;
    };

    Window_CabbyCodesLockedDoorsList.prototype.drawItem = function(index) {
        const rect = this.itemLineRect(index);
        const door = this._doors[index];
        if (!door) {
            return;
        }
        const valueText = doorStateLabel(door);
        const valueWidth = this.textWidth('Unlocked');
        const labelWidth = Math.max(0, rect.width - valueWidth - 8);
        this.resetTextColor();
        this.changeTextColor(ColorManager.systemColor());
        this.drawText(door.label, rect.x, rect.y, labelWidth, 'left');
        this.resetTextColor();
        this.drawText(valueText, rect.x + rect.width - valueWidth, rect.y, valueWidth, 'right');
    };

    window.Window_CabbyCodesLockedDoorsList = Window_CabbyCodesLockedDoorsList;

    CabbyCodes.openLockedDoorsScene = openLockedDoorsScene;

    CabbyCodes.log('[CabbyCodes] Locked Doors module loaded');
})();
