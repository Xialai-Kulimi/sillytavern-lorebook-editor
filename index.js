let worldInfoModule;

// Attempt to dynamically import the core world-info module using both possible relative paths
try {
    worldInfoModule = await import('../../world-info.js');
} catch (e) {
    try {
        worldInfoModule = await import('../../../world-info.js');
    } catch (err) {
        console.error("[Lorebook Editor Tool] Failed to import world-info.js", err);
    }
}

if (worldInfoModule) {
    const { 
        saveWorldInfo, 
        loadWorldInfo, 
        createWorldInfoEntry, 
        selected_world_info,
        reloadEditor
    } = worldInfoModule;

    const { registerFunctionTool, isToolCallingSupported, getContext } = SillyTavern.getContext();

    if (isToolCallingSupported()) {
        console.log("[Lorebook Editor Tool] Registering AI tools...");

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
                    const worldName = selected_world_info[0];
                    if (!worldName) {
                        return "Error: No active lorebook (World Info) bound to the current chat session. Ask the user to assign a lorebook first.";
                    }
                    const data = await loadWorldInfo(worldName);
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
                    const worldName = selected_world_info[0];
                    if (!worldName) {
                        return "Error: No active lorebook bound to the current chat session.";
                    }
                    const data = await loadWorldInfo(worldName);
                    if (!data) {
                        return `Error: Failed to load lorebook "${worldName}".`;
                    }

                    // Create entry inside SillyTavern core data structures
                    const newEntry = createWorldInfoEntry(worldName, data);
                    if (!newEntry) {
                        return "Error: Failed to instantiate a new entry in core structures.";
                    }

                    newEntry.content = content;
                    newEntry.key = keys;
                    if (comment !== undefined) {
                        newEntry.comment = comment;
                    }

                    // Save immediately to disk and reload the editor UI
                    await saveWorldInfo(worldName, data, true);
                    if (typeof reloadEditor === 'function') {
                        reloadEditor(worldName);
                    }

                    return `Successfully created new entry UID ${newEntry.uid} in lorebook "${worldName}" with keys: [${keys.join(', ')}].`;
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
                    const worldName = selected_world_info[0];
                    if (!worldName) {
                        return "Error: No active lorebook bound to the current chat session.";
                    }
                    const data = await loadWorldInfo(worldName);
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

                    // Save immediately to disk and reload editor UI
                    await saveWorldInfo(worldName, data, true);
                    if (typeof reloadEditor === 'function') {
                        reloadEditor(worldName);
                    }

                    return `Successfully updated entry UID ${uid} in lorebook "${worldName}".`;
                } catch (err) {
                    return `Error updating entry: ${err.message}`;
                }
            }
        });

        console.log("[Lorebook Editor Tool] All tools registered successfully.");
    } else {
        console.warn("[Lorebook Editor Tool] Function calling is not supported or not enabled in settings.");
    }
} else {
    console.error("[Lorebook Editor Tool] world-info.js core module could not be resolved.");
}
