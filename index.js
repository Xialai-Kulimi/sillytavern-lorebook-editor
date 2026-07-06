const { registerFunctionTool, isToolCallingSupported, getContext } = SillyTavern.getContext();

// Helper to resolve the active character's primary or additional world info name. Returns null if not bound.
function getActiveWorldName() {
    const context = SillyTavern.getContext();
    const chid = context.characterId;
    if (!context.characters || chid === undefined || !context.characters[chid]) {
        return null;
    }
    const char = context.characters[chid];

    // 1. Highest Priority: Read the active character's primary world info from character data
    if (char.data && char.data.extensions && char.data.extensions.world) {
        const world = char.data.extensions.world.trim();
        if (world !== "") return world;
    }

    // 2. Second Priority: Read from the character's world selection DOM select element (#character_world)
    const charWorldDom = $('#character_world').val();
    if (charWorldDom && typeof charWorldDom === 'string' && charWorldDom.trim() !== "") {
        return charWorldDom.trim();
    }

    // 3. Third Priority: Read the active character's additional worlds
    if (char.data && char.data.extensions && char.data.extensions.additional_worlds) {
        const additional = char.data.extensions.additional_worlds;
        if (Array.isArray(additional) && additional.length > 0 && additional[0] !== "") {
            return additional[0].trim();
        }
    }

    // No primary or additional lorebook is bound to the current character
    return null;
}

// Helper to find a free UID in entries
function getFreeUid(data) {
    if (!data.entries) return 1;
    let max = 0;
    for (const uid of Object.keys(data.entries)) {
        const num = Number(uid);
        if (num > max) max = num;
    }
    return max + 1;
}

// === REGISTER NATIVE TOOLS ===
if (isToolCallingSupported()) {
    console.log("[Lorebook Editor Tool] Registering AI native tools using exclusively SillyTavern getContext() APIs...");

    // Tool 1: Get active lorebook entries
    registerFunctionTool({
        name: 'get_lorebook_entries',
        displayName: 'Get Lorebook Entries',
        description: 'Retrieves all existing entries in a specified lorebook. You can target a specific lorebook file. If world_name is omitted, it will automatically fall back to the currently active character primary lorebook.',
        parameters: {
            type: 'object',
            properties: {
                world_name: { 
                    type: 'string', 
                    description: 'The name of the lorebook to read (e.g., "Size Queen Harem"). If omitted, falls back to the character primary lorebook.' 
                }
            }
        },
        action: async ({ world_name }) => {
            try {
                const targetWorld = (world_name || getActiveWorldName());
                if (!targetWorld) {
                    return "Error: The active character has no primary lorebook bound to their profile. Please ask the user to assign a primary world info (lorebook) to the character first in the character settings panel.";
                }
                
                const context = SillyTavern.getContext();
                const loadWorldInfo = context.loadWorldInfo;
                if (typeof loadWorldInfo !== 'function') {
                    return "Error: SillyTavern loadWorldInfo function is not available in current getContext.";
                }

                const data = await loadWorldInfo(targetWorld);
                if (!data || !data.entries || Object.keys(data.entries).length === 0) {
                    return `Lorebook "${targetWorld}" has no entries or is empty.`;
                }
                
                const result = Object.entries(data.entries).map(([uid, entry]) => ({
                    uid: uid,
                    keys: entry.key || [],
                    content: entry.content || "",
                    comment: entry.comment || ""
                }));
                
                return JSON.stringify({
                    lorebook: targetWorld,
                    entries: result
                }, null, 2);
            } catch (err) {
                return `Error fetching entries: ${err.message}`;
            }
        }
    });

    // Tool 2: Create a new lorebook entry
    registerFunctionTool({
        name: 'create_lorebook_entry',
        displayName: 'Create Lorebook Entry',
        description: 'Creates a brand new entry in a specified lorebook. You can specify which lorebook file to write to. If the specified lorebook file does not exist, a new one will be created automatically. Provide relevant trigger keywords.',
        parameters: {
            type: 'object',
            properties: {
                content: { 
                    type: 'string', 
                    description: 'The detailed description of the new entry (e.g., location settings, character profile, rules).' 
                },
                keys: { 
                    type: 'array', 
                    items: { type: 'string' }, 
                    description: 'Trigger keywords (e.g., ["Gym", "Fitness Center"]) that will load this entry into context.' 
                },
                world_name: { 
                    type: 'string', 
                    description: 'The name of the lorebook to write to (e.g., "Aetheria World"). If omitted, writes to the currently active character primary lorebook.' 
                },
                comment: { 
                    type: 'string', 
                    description: 'A brief note classifying this entry (e.g., "Location", "NPC Relationship", "Facility Status").' 
                }
            },
            required: ['content', 'keys']
        },
        action: async ({ content, keys, world_name, comment }) => {
            try {
                const targetWorld = (world_name || getActiveWorldName());
                if (!targetWorld) {
                    return "Error: The active character has no primary lorebook bound to their profile. Please ask the user to assign a primary world info (lorebook) to the character first in the character settings panel.";
                }

                const context = SillyTavern.getContext();
                const { loadWorldInfo, saveWorldInfo, reloadWorldInfoEditor, updateWorldInfoList } = context;

                if (typeof loadWorldInfo !== 'function' || typeof saveWorldInfo !== 'function') {
                    return "Error: SillyTavern world-info native storage APIs are not available in current getContext.";
                }

                const data = await loadWorldInfo(targetWorld);
                if (!data.entries) data.entries = {};

                const newUid = getFreeUid(data);
                const newEntry = {
                    uid: newUid,
                    key: keys,
                    content: content,
                    comment: comment || "AI Generated",
                    enabled: true,
                    constant: false,
                    selective: false,
                    order: 100
                };
                
                data.entries[newUid] = newEntry;

                // Call SillyTavern's native saveWorldInfo function from context (100% guarantees correct instance)
                await saveWorldInfo(targetWorld, data, true);

                // Call native reload functions to instantly force UI update
                if (typeof updateWorldInfoList === 'function') {
                    await updateWorldInfoList();
                }
                if (typeof reloadWorldInfoEditor === 'function') {
                    await reloadWorldInfoEditor(targetWorld);
                }

                // Force simulate dropdown re-selection to clear and repaint DOM elements
                const editorSelect = $('#world_editor_select');
                if (editorSelect.length > 0) {
                    const currentIdx = editorSelect.val();
                    if (currentIdx !== null && currentIdx !== "") {
                        editorSelect.val("").trigger('change');
                        setTimeout(() => {
                            editorSelect.val(currentIdx).trigger('change');
                        }, 50);
                    }
                }
                
                toastr.success(`[世界書: ${targetWorld}] 成功建立條目：${keys.join(', ')}`);
                return `Successfully created new entry UID ${newUid} in lorebook "${targetWorld}" with keys: [${keys.join(', ')}].`;
            } catch (err) {
                return `Error creating entry: ${err.message}`;
            }
        }
    });

    // Tool 3: Update an existing lorebook entry
    registerFunctionTool({
        name: 'update_lorebook_entry',
        displayName: 'Update Lorebook Entry',
        description: 'Updates an existing entry in a specified lorebook using its UID. You can specify which lorebook file to modify.',
        parameters: {
            type: 'object',
            properties: {
                uid: { 
                    type: 'string', 
                    description: 'The unique ID (UID) of the lorebook entry to update.' 
                },
                world_name: { 
                    type: 'string', 
                    description: 'The name of the lorebook to modify. If omitted, targets the active character primary lorebook.' 
                },
                content: { 
                    type: 'string', 
                    description: 'The new description/details for the entry. Leave undefined to keep existing.' 
                },
                keys: { 
                    type: 'array', 
                    items: { type: 'string' }, 
                    description: 'New trigger keywords. Leave undefined to keep existing.' 
                },
                comment: { 
                    type: 'string', 
                    description: 'Updated note/classification. Leave undefined to keep existing.' 
                }
            },
            required: ['uid']
        },
        action: async ({ uid, world_name, content, keys, comment }) => {
            try {
                const targetWorld = (world_name || getActiveWorldName());
                if (!targetWorld) {
                    return "Error: The active character has no primary lorebook bound to their profile. Please ask the user to assign a primary world info (lorebook) to the character first in the character settings panel.";
                }

                const context = SillyTavern.getContext();
                const { loadWorldInfo, saveWorldInfo, reloadWorldInfoEditor, updateWorldInfoList } = context;

                if (typeof loadWorldInfo !== 'function' || typeof saveWorldInfo !== 'function') {
                    return "Error: SillyTavern world-info native storage APIs are not available in current getContext.";
                }

                const data = await loadWorldInfo(targetWorld);
                if (!data || !data.entries) {
                    return `Error: Failed to load lorebook "${targetWorld}".`;
                }

                const entry = data.entries[uid];
                if (!entry) {
                    return `Error: Entry with UID "${uid}" was not found in lorebook "${targetWorld}".`;
                }

                if (content !== undefined) entry.content = content;
                if (keys !== undefined) entry.key = keys;
                if (comment !== undefined) entry.comment = comment;

                // Call SillyTavern's native saveWorldInfo function from context (100% guarantees correct instance)
                await saveWorldInfo(targetWorld, data, true);

                // Call native reload functions to instantly force UI update
                if (typeof updateWorldInfoList === 'function') {
                    await updateWorldInfoList();
                }
                if (typeof reloadWorldInfoEditor === 'function') {
                    await reloadWorldInfoEditor(targetWorld);
                }

                // Force simulate dropdown re-selection to clear and repaint DOM elements
                const editorSelect = $('#world_editor_select');
                if (editorSelect.length > 0) {
                    const currentIdx = editorSelect.val();
                    if (currentIdx !== null && currentIdx !== "") {
                        editorSelect.val("").trigger('change');
                        setTimeout(() => {
                            editorSelect.val(currentIdx).trigger('change');
                        }, 50);
                    }
                }
                
                toastr.success(`[世界書: ${targetWorld}] 成功更新條目 (UID: ${uid})`);
                return `Successfully updated entry UID ${uid} in lorebook "${targetWorld}".`;
            } catch (err) {
                return `Error updating entry: ${err.message}`;
            }
        }
    });

    console.log("[Lorebook Editor Tool] All native tools registered successfully using getContext() API mapping.");
} else {
    console.warn("[Lorebook Editor Tool] Function calling is not supported or not enabled in settings.");
}
