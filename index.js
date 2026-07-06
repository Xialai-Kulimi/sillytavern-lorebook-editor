const { registerFunctionTool, isToolCallingSupported, getContext } = SillyTavern.getContext();

// Direct fetch of the CSRF token from the server to guarantee validity regardless of global scope access
async function getCsrfTokenDirect() {
    try {
        const response = await $.getJSON('/csrf-token');
        return response.token || "";
    } catch (e) {
        console.error("[Lorebook Editor Tool] Failed to fetch CSRF token from server:", e);
        return "";
    }
}

// Helper to resolve the active world name bound to the chat
function getActiveWorldName() {
    // 1. Highest Priority: Read the actual selected world info from the SillyTavern UI DOM select element
    const domVal = $('#world_info').val();
    if (domVal) {
        if (Array.isArray(domVal) && domVal.length > 0 && domVal[0] !== "") {
            return domVal[0];
        } else if (typeof domVal === 'string' && domVal !== "") {
            return domVal;
        }
    }

    // 2. Fallback: World Info editor's active selection
    if (window.selected_world_info && window.selected_world_info[0]) {
        return window.selected_world_info[0];
    }
    
    // 3. Fallback: Check window lists
    if (window.world_names && window.world_names[0]) {
        const selectEl = document.getElementById('world_editor_select');
        if (selectEl && selectEl.value !== "") {
            const index = Number(selectEl.value);
            if (window.world_names[index]) return window.world_names[index];
        }
    }

    // 4. Fallback: Context chatMetadata
    const context = SillyTavern.getContext();
    if (context.chatMetadata && context.chatMetadata.world_info) {
        return context.chatMetadata.world_info;
    }

    // 5. Fallback: Active character default world info
    if (context.characters && context.characterId !== undefined && context.characters[context.characterId]) {
        const char = context.characters[context.characterId];
        if (char.data && char.data.world) {
            return char.data.world;
        }
    }

    // 6. Absolute Fallback
    return "DefaultWorld";
}

// Fetch world info using $.ajax with manually retrieved CSRF token
async function fetchWorldInfo(worldName) {
    try {
        const token = await getCsrfTokenDirect();
        const response = await $.ajax({
            url: '/api/worldinfo/get',
            type: 'POST',
            headers: {
                'X-CSRF-Token': token,
                'Content-Type': 'application/json'
            },
            data: JSON.stringify({ name: worldName }),
            dataType: 'json'
        });
        return response;
    } catch (e) {
        console.warn(`[Lorebook Editor Tool] Failed to fetch world info for "${worldName}", assuming empty/new.`, e);
        return { entries: {} };
    }
}

// Save world info using $.ajax with manually retrieved CSRF token
async function saveWorldInfoDirect(worldName, data) {
    try {
        const token = await getCsrfTokenDirect();
        await $.ajax({
            url: '/api/worldinfo/edit',
            type: 'POST',
            headers: {
                'X-CSRF-Token': token,
                'Content-Type': 'application/json'
            },
            data: JSON.stringify({ name: worldName, data: data }),
            dataType: 'json'
        });
    } catch (err) {
        throw new Error(`AJAX request failed: HTTP ${err.status} - ${err.statusText || 'Forbidden'}`);
    }

    // Refresh UI cache and editors immediately
    if (window.worldInfoCache && typeof window.worldInfoCache.set === 'function') {
        window.worldInfoCache.set(worldName, data);
    }
    if (window.eventSource && window.event_types) {
        await window.eventSource.emit(window.event_types.WORLDINFO_UPDATED, worldName, data);
    }
    if (typeof window.reloadEditor === 'function') {
        window.reloadEditor(worldName);
    }
    
    // Auto add to active list if not already selected in current session
    if (window.selected_world_info && !window.selected_world_info.includes(worldName)) {
        window.selected_world_info.push(worldName);
        $('#world_info').val(window.selected_world_info).trigger('change');
    }
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
    console.log("[Lorebook Editor Tool] Registering AI native tools with standalone CSRF fetching...");

    // Tool 1: Get active lorebook entries
    registerFunctionTool({
        name: 'get_lorebook_entries',
        displayName: 'Get Lorebook Entries',
        description: 'Retrieves all existing entries in a specified lorebook. You can target a specific lorebook file. If world_name is omitted, it will automatically fall back to the currently active lorebook.',
        parameters: {
            type: 'object',
            properties: {
                world_name: { 
                    type: 'string', 
                    description: 'The name of the lorebook to read (e.g., "Size Queen Harem"). If omitted, falls back to active chat lorebook.' 
                }
            }
        },
        action: async ({ world_name }) => {
            try {
                const targetWorld = (world_name || getActiveWorldName()).trim();
                const data = await fetchWorldInfo(targetWorld);
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
                    description: 'The name of the lorebook to write to (e.g., "Aetheria World"). If omitted, writes to the currently active chat lorebook.' 
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
                const targetWorld = (world_name || getActiveWorldName()).trim();
                const data = await fetchWorldInfo(targetWorld);
                
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

                await saveWorldInfoDirect(targetWorld, data);
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
                    description: 'The name of the lorebook to modify. If omitted, targets the active chat lorebook.' 
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
                const targetWorld = (world_name || getActiveWorldName()).trim();
                const data = await fetchWorldInfo(targetWorld);
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

                await saveWorldInfoDirect(targetWorld, data);
                toastr.success(`[世界書: ${targetWorld}] 成功更新條目 (UID: ${uid})`);
                return `Successfully updated entry UID ${uid} in lorebook "${targetWorld}".`;
            } catch (err) {
                return `Error updating entry: ${err.message}`;
            }
        }
    });

    console.log("[Lorebook Editor Tool] All native tools registered successfully with direct CSRF management.");
} else {
    console.warn("[Lorebook Editor Tool] Function calling is not supported or not enabled in settings.");
}
