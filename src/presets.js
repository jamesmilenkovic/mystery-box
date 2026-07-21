// Pure module: preset (saved box) CRUD, cap enforcement, and the
// whitelist-serializer pattern extended from force-mode.js's
// serializeBoxForStorage — SPEC.md increment 4, workstream A.
//
// Binding guardrail this module exists to uphold (PRD principle 5, same
// one force-mode.js guards): force/armed state must never serialize into
// a preset. buildPreset()/serializePresetOptions() destructure only
// {label, emoji, photoId} off each chip, exactly mirroring
// serializeBoxForStorage's narrow whitelist — a chip carrying an
// "armed"/extra field (or the fact that some OTHER chip is currently
// armed, tracked entirely outside the chip objects in app.js) can never
// reach the stored payload even by accident.

export const MAX_PRESETS = 12;

function randomPresetId() {
  return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Whitelists a chip list down to the {label, emoji, photoId} shape a
 * preset stores per option — same shape/rules as serializeBoxForStorage.
 *
 * @param {{label: string, emoji: string, photoId?: string|null}[]} chips
 * @returns {{label: string, emoji: string, photoId: string|null}[]}
 */
export function serializePresetOptions(chips) {
  return chips.map(({ label, emoji, photoId }) => ({ label, emoji, photoId: photoId ?? null }));
}

/**
 * Builds a fresh preset object from a name, icon, and the chip list to
 * save. The only place a preset id is minted.
 *
 * @param {string} name
 * @param {string} icon - an emoji (matchEmoji's result, or a tap-to-fix pick).
 * @param {{label: string, emoji: string, photoId?: string|null}[]} chips
 * @returns {{id: string, name: string, icon: string, options: object[]}}
 */
export function buildPreset(name, icon, chips) {
  return {
    id: randomPresetId(),
    name,
    icon,
    options: serializePresetOptions(chips),
  };
}

/**
 * Narrow whitelist for a single already-built preset, mirroring
 * serializeBoxForStorage — the single choke point everything persisted to
 * localStorage goes through, so no stray property can ever leak in.
 *
 * @param {{id: string, name: string, icon: string, options: object[]}} preset
 */
export function serializePresetForStorage({ id, name, icon, options }) {
  return { id, name, icon, options: serializePresetOptions(options) };
}

/**
 * @param {object[]} presets
 * @returns {object[]}
 */
export function serializePresetsForStorage(presets) {
  return presets.map(serializePresetForStorage);
}

/** @param {object[]} presets */
export function canAddPreset(presets) {
  return presets.length < MAX_PRESETS;
}

/**
 * Appends a preset, enforcing the 12-cap (SPEC.md workstream A3). A no-op
 * (returns the same array reference) once the cap is reached.
 *
 * @param {object[]} presets
 * @param {object} preset
 * @returns {object[]}
 */
export function addPreset(presets, preset) {
  if (!canAddPreset(presets)) return presets;
  return [...presets, preset];
}

/** @param {object[]} presets @param {string} id */
export function removePreset(presets, id) {
  return presets.filter((p) => p.id !== id);
}

/** @param {object[]} presets @param {string} id @param {string} name */
export function renamePreset(presets, id, name) {
  return presets.map((p) => (p.id === id ? { ...p, name } : p));
}

/** @param {object[]} presets @param {string} id @param {string} icon */
export function updatePresetIcon(presets, id, icon) {
  return presets.map((p) => (p.id === id ? { ...p, icon } : p));
}

/**
 * Every photoId referenced by any preset's options — used by the startup
 * GC sweep (SPEC.md workstream A5), which must keep a blob referenced by
 * either the current box OR any preset.
 *
 * @param {object[]} presets
 * @returns {string[]}
 */
export function referencedPhotoIds(presets) {
  const ids = [];
  for (const preset of presets) {
    for (const option of preset.options) {
      if (option.photoId) ids.push(option.photoId);
    }
  }
  return ids;
}

/**
 * Which of a just-deleted preset's photoIds are now unreferenced anywhere
 * else (not the current box, not any remaining preset) and should be
 * released via the existing deleteChipPhoto() choke point.
 *
 * @param {object} deletedPreset
 * @param {{photoId?: string|null}[]} chips - the current box's chips.
 * @param {object[]} remainingPresets - presets after the delete.
 * @returns {string[]}
 */
export function orphanedPhotoIdsOnDelete(deletedPreset, chips, remainingPresets) {
  const stillReferenced = new Set([
    ...chips.filter((c) => c.photoId).map((c) => c.photoId),
    ...referencedPhotoIds(remainingPresets),
  ]);
  return deletedPreset.options.filter((o) => o.photoId && !stillReferenced.has(o.photoId)).map((o) => o.photoId);
}
