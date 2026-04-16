#!/usr/bin/env node

/**
 * Detect whether the Look Outside install has been patched and, when it has,
 * replace the local `game_files/` reference mirror with a fresh copy from the
 * Steam install.
 *
 *   node scripts/refresh-game-files.js            # refresh only if buildid changed
 *   node scripts/refresh-game-files.js --check    # report status, do not modify
 *   node scripts/refresh-game-files.js --force    # refresh even if buildid matches
 *
 * Exit codes:
 *   0 — cache is current (or was just refreshed successfully)
 *   1 — usage / unexpected error
 *   2 — patch detected (only used with --check)
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const GAME_INSTALL = 'C:/Program Files (x86)/Steam/steamapps/common/Look Outside';
const STEAM_APPID = '3373660';
const STEAM_MANIFEST = `C:/Program Files (x86)/Steam/steamapps/appmanifest_${STEAM_APPID}.acf`;
const CACHE_DIR = path.join(REPO_ROOT, 'game_files');
const CACHE_MANIFEST = path.join(CACHE_DIR, '.manifest.json');

// Subpaths copied from the game install into game_files/. Paths are relative
// to GAME_INSTALL. Anything not in this list stays out of the cache.
const SYNC_TARGETS = [
    { src: 'js', kind: 'dir' },
    { src: 'data', kind: 'dir' },
    { src: 'package.json', kind: 'file' },
];

// Key files whose hash we fingerprint in the manifest so we can catch
// hand-patched mods even when Steam's buildid hasn't moved.
const FINGERPRINT_FILES = [
    'package.json',
    'js/plugins.js',
    'js/rmmz_objects.js',
    'js/rmmz_managers.js',
    'data/System.json',
    'data/CommonEvents.json',
];

function parseArgs(argv) {
    const flags = { check: false, force: false };
    for (const arg of argv.slice(2)) {
        if (arg === '--check') flags.check = true;
        else if (arg === '--force') flags.force = true;
        else {
            console.error(`Unknown argument: ${arg}`);
            process.exit(1);
        }
    }
    return flags;
}

function readSteamBuildId() {
    if (!fs.existsSync(STEAM_MANIFEST)) {
        return null;
    }
    const text = fs.readFileSync(STEAM_MANIFEST, 'utf8');
    const match = text.match(/"buildid"\s*"(\d+)"/);
    return match ? match[1] : null;
}

function readCacheManifest() {
    if (!fs.existsSync(CACHE_MANIFEST)) return null;
    try {
        return JSON.parse(fs.readFileSync(CACHE_MANIFEST, 'utf8'));
    } catch (err) {
        console.warn(`[refresh] Cache manifest unreadable (${err.message}); treating as missing.`);
        return null;
    }
}

function sha256(filePath) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
}

function fingerprintInstall() {
    const out = {};
    for (const rel of FINGERPRINT_FILES) {
        const abs = path.join(GAME_INSTALL, rel);
        out[rel] = fs.existsSync(abs) ? sha256(abs) : null;
    }
    return out;
}

function fingerprintsEqual(a, b) {
    if (!a || !b) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        if (a[k] !== b[k]) return false;
    }
    return true;
}

function copyRecursive(src, dest) {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src)) {
            copyRecursive(path.join(src, entry), path.join(dest, entry));
        }
    } else if (stat.isFile()) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
    }
}

function removeRecursive(target) {
    if (!fs.existsSync(target)) return;
    fs.rmSync(target, { recursive: true, force: true });
}

function refresh(buildId, fingerprint) {
    console.log('[refresh] Clearing game_files/ ...');
    removeRecursive(CACHE_DIR);
    fs.mkdirSync(CACHE_DIR, { recursive: true });

    for (const target of SYNC_TARGETS) {
        const srcAbs = path.join(GAME_INSTALL, target.src);
        const destAbs = path.join(CACHE_DIR, target.src);
        if (!fs.existsSync(srcAbs)) {
            console.warn(`[refresh] Skipping missing source: ${target.src}`);
            continue;
        }
        console.log(`[refresh] Copying ${target.src} ...`);
        copyRecursive(srcAbs, destAbs);
    }

    const manifest = {
        refreshedAt: new Date().toISOString(),
        steamAppId: STEAM_APPID,
        buildId: buildId,
        gameInstall: GAME_INSTALL,
        fingerprint: fingerprint,
    };
    fs.writeFileSync(CACHE_MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log(`[refresh] Wrote ${path.relative(REPO_ROOT, CACHE_MANIFEST)} (buildid=${buildId ?? 'unknown'}).`);
}

function main() {
    const flags = parseArgs(process.argv);

    if (!fs.existsSync(GAME_INSTALL)) {
        console.error(`[refresh] Game install not found: ${GAME_INSTALL}`);
        process.exit(1);
    }

    const currentBuild = readSteamBuildId();
    const cached = readCacheManifest();
    const cachedBuild = cached?.buildId ?? null;
    const liveFingerprint = fingerprintInstall();
    const cachedFingerprint = cached?.fingerprint ?? null;

    const buildChanged = currentBuild !== cachedBuild;
    const fingerprintChanged = !fingerprintsEqual(liveFingerprint, cachedFingerprint);
    const cacheMissing = !cached;
    const patched = cacheMissing || buildChanged || fingerprintChanged;

    console.log(`[refresh] Steam buildid: ${currentBuild ?? 'unknown'}`);
    console.log(`[refresh] Cached buildid: ${cachedBuild ?? 'none'}`);
    if (fingerprintChanged) {
        const changed = FINGERPRINT_FILES.filter(
            (f) => (cachedFingerprint?.[f] ?? null) !== liveFingerprint[f]
        );
        console.log(`[refresh] Fingerprint mismatch on: ${changed.join(', ') || '(none listed)'}`);
    }

    if (flags.check) {
        if (patched) {
            console.log('[refresh] STATUS: patch detected — run without --check to refresh.');
            process.exit(2);
        }
        console.log('[refresh] STATUS: cache current.');
        process.exit(0);
    }

    if (!patched && !flags.force) {
        console.log('[refresh] Cache current; nothing to do. Pass --force to refresh anyway.');
        process.exit(0);
    }

    refresh(currentBuild, liveFingerprint);
    console.log('[refresh] Done.');
}

main();
