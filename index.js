const { registerFunctionTool, isToolCallingSupported, getContext } = SillyTavern.getContext();

// Helper to get request headers with CSRF/Auth tokens
const getHeaders = window.getRequestHeaders || (() => ({ 
    'Content-Type': 'application/json',
    'X-CSRF-Token': window.csrf_token || ''
}));

// Helper to resolve the active world name bound to the chat
function getActiveWorldName() {
    // 1. Try global selected_world_info array
    if (window.selected_world_info && window.selected_world_info[0]) {
        return window.selected_world_info[0];
    }
    // 2. Try window variables
    if (window.world_names && window.world_names[0]) {
        // Fallback to first available world if editor is open
        const selectEl = document.getElementById('world_editor_select');
        if (selectEl && selectEl.value !== "") {
            const index = Number(selectEl.value);
            if (window.world_names[index]) return window.world_names[index];
        }
    }
    // 3. Try context chatMetadata
    const context = SillyTavern.getContext();
    if (context.chatMetadata && context.chatMetadata.world_info) {
        return context.chatMetadata.world_info;
    }
    // 4. Try active character primary world
    if (context.characters && context.characterId !== undefined && context.characters[context.characterId]) {
        const char = context.characters[context.characterId];
        if (char.data && char.data.world) {
            return char.data.world;
        }
    }
    return null;
}

// Fetch world info directly via API endpoint
async function fetchWorldInfo(worldName) {
    const response = await fetch('/api/worldinfo/get', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ name: worldName })
    });
    if (!response.ok) {
        throw new Error(`Failed to load world info: HTTP ${response.status}`);
    }
    return await response.json();
}

// Save world info directly via API endpoint and refresh UI
async function saveWorldInfoDirect(worldName, data) {
    const response = await fetch('/api/worldinfo/edit', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ name: worldName, data: data })
    });
    if (!response.ok) {
        throw new Error(`Failed to save world info: HTTP ${response.status}`);
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
    console.log("[Lorebook Editor Tool] Registering AI native tools via SillyTavern Context API...");

    // Tool 1: Get active lorebook entries
    registerFunctionTool({
        name: 'get_lorebook_entries',
        displayName: 'Get Lorebook Entries',
        description: 'Retrieves all existing entries, their UIDs, trigger keys, comments, and contents in the currently active lorebook. Use this to inspect current world state, character relationships, and locations.',
        parameters: {
            type: 'object',
            properties: {}
        },
        action: async () => {
            try {
                const worldName = getActiveWorldName();
                if (!worldName) {
                    return "Error: No active lorebook bound to the current chat session. Ask the user to assign a lorebook first.";
                }
                const data = await fetchWorldInfo(worldName);
                if (!data || !data.entries) {
                    return `Lorebook "${worldName}" has no entries or is empty.`;
                }
                
                const result = Object.entries(data.entries).map(([uid, entry]) => ({
                    uid: uid,
                    keys: entry.key || [],
                    content: entry.content || "",
                    comment: entry.comment || ""
                }));
                
                return JSON.stringify({
                    lorebook: worldName,
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
        description: 'Creates a brand new entry in the active lorebook. Use this when the player builds a new facility, travels to an undiscovered area, or when a new NPC is introduced. Always provide relevant trigger keywords.',
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
                comment: { 
                    type: 'string', 
                    description: 'A brief note classifying this entry (e.g., "Location", "NPC Relationship", "Facility Status").' 
                }
            },
            required: ['content', 'keys']
        },
        action: async ({ content, keys, comment }) => {
            try {
                const worldName = getActiveWorldName();
                if (!worldName) {
                    return "Error: No active lorebook bound to the current chat session.";
                }
                const data = await fetchWorldInfo(worldName);
                if (!data) {
                    return `Error: Failed to load lorebook "${worldName}".`;
                }

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

                await saveWorldInfoDirect(worldName, data);
                toastr.success(`[世界書] 成功建立條目：${keys.join(', ')}`);
                return `Successfully created new entry UID ${newUid} in lorebook "${worldName}" with keys: [${keys.join(', ')}].`;
            } catch (err) {
                return `Error creating entry: ${err.message}`;
            }
        }
    });

    // Tool 3: Update an existing lorebook entry
    registerFunctionTool({
        name: 'update_lorebook_entry',
        displayName: 'Update Lorebook Entry',
        description: 'Updates an existing entry in the active lorebook using its UID. Use this to dynamically edit facility status (e.g., broken, upgraded), character relationships (e.g., relationship levels), or location descriptions.',
        parameters: {
            type: 'object',
            properties: {
                uid: { 
                    type: 'string', 
                    description: 'The unique ID (UID) of the lorebook entry to update.' 
                    },
                content: { 
                    type: 'string', 
                    description: 'The new description/details for the entry. Leave undefined if you do not want to modify the content.' 
                },
                keys: { 
                    type: 'array', 
                    items: { type: 'string' }, 
                    description: 'New trigger keywords. Leave undefined if you do not want to modify triggers.' 
                },
                comment: { 
                    type: 'string', 
                    description: 'Updated note/classification. Leave undefined if you do not want to modify it.' 
                }
            },
            required: ['uid']
        },
        action: async ({ uid, content, keys, comment }) => {
            try {
                const worldName = getActiveWorldName();
                if (!worldName) {
                    return "Error: No active lorebook bound to the current chat session.";
                }
                const data = await fetchWorldInfo(worldName);
                if (!data || !data.entries) {
                    return `Error: Failed to load lorebook "${worldName}".`;
                }

                const entry = data.entries[uid];
                if (!entry) {
                    return `Error: Entry with UID "${uid}" was not found in lorebook "${worldName}".`;
                }

                if (content !== undefined) entry.content = content;
                if (keys !== undefined) entry.key = keys;
                if (comment !== undefined) entry.comment = comment;

                await saveWorldInfoDirect(worldName, data);
                toastr.success(`[世界書] 成功更新條目 (UID: ${uid})`);
                return `Successfully updated entry UID ${uid} in lorebook "${worldName}".`;
            } catch (err) {
                return `Error updating entry: ${err.message}`;
            }
        }
    });

    console.log("[Lorebook Editor Tool] All native tools registered successfully.");
} else {
    console.warn("[Lorebook Editor Tool] Function calling is not supported or not enabled in settings.");
}
