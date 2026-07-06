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

    const { registerFunctionTool, isToolCallingSupported, eventSource, event_types, getContext } = SillyTavern.getContext();

    // Helper: Create entry
    async function handleCreate({ keys, content, comment }) {
        const worldName = selected_world_info[0];
        if (!worldName) return "Error: No active lorebook bound to the current chat session.";
        const data = await loadWorldInfo(worldName);
        if (!data) return `Error: Failed to load lorebook "${worldName}".`;

        const newEntry = createWorldInfoEntry(worldName, data);
        if (!newEntry) return "Error: Failed to instantiate a new entry.";

        newEntry.content = content;
        newEntry.key = keys;
        if (comment !== undefined) newEntry.comment = comment;

        await saveWorldInfo(worldName, data, true);
        if (typeof reloadEditor === 'function') reloadEditor(worldName);
        console.log(`[Lorebook Editor Tool] Created entry UID ${newEntry.uid} via XML or API.`);
        return newEntry.uid;
    }

    // Helper: Update entry
    async function handleUpdate({ uid, content, keys, comment }) {
        const worldName = selected_world_info[0];
        if (!worldName) return "Error: No active lorebook bound to the current chat session.";
        const data = await loadWorldInfo(worldName);
        if (!data || !data.entries) return `Error: Failed to load lorebook "${worldName}".`;

        const entry = data.entries[uid];
        if (!entry) return `Error: Entry with UID "${uid}" not found.`;

        if (content !== undefined) entry.content = content;
        if (keys !== undefined) entry.key = keys;
        if (comment !== undefined) entry.comment = comment;

        await saveWorldInfo(worldName, data, true);
        if (typeof reloadEditor === 'function') reloadEditor(worldName);
        console.log(`[Lorebook Editor Tool] Updated entry UID ${uid} via XML or API.`);
        return `Success`;
    }

    // Helper: Find UID by name (for smart XML update without knowing UID)
    async function findUidByName(name) {
        const worldName = selected_world_info[0];
        if (!worldName) return null;
        const data = await loadWorldInfo(worldName);
        if (!data || !data.entries) return null;

        // Try to match key or comment
        for (const [uid, entry] of Object.entries(data.entries)) {
            const keys = entry.key || [];
            if (keys.some(k => k.toLowerCase() === name.toLowerCase()) || 
                (entry.comment && entry.comment.toLowerCase().includes(name.toLowerCase()))) {
                return uid;
            }
        }
        return null;
    }

    // === 1. NATIVE FUNCTION CALLING REGISTRATION ===
    if (isToolCallingSupported()) {
        console.log("[Lorebook Editor Tool] Registering AI native tools...");

        registerFunctionTool({
            name: 'get_lorebook_entries',
            displayName: 'Get Lorebook Entries',
            description: 'Retrieves all existing entries, their UIDs, trigger keys, comments, and contents in the active lorebook.',
            parameters: { type: 'object', properties: {} },
            action: async () => {
                try {
                    const worldName = selected_world_info[0];
                    if (!worldName) return "Error: No active lorebook bound to chat.";
                    const data = await loadWorldInfo(worldName);
                    if (!data || !data.entries) return `Lorebook "${worldName}" is empty.`;
                    
                    const result = Object.entries(data.entries).map(([uid, entry]) => ({
                        uid: uid,
                        keys: entry.key || [],
                        content: entry.content || "",
                        comment: entry.comment || ""
                    }));
                    return JSON.stringify({ lorebook: worldName, entries: result }, null, 2);
                } catch (err) {
                    return `Error: ${err.message}`;
                }
            }
        });

        registerFunctionTool({
            name: 'create_lorebook_entry',
            displayName: 'Create Lorebook Entry',
            description: 'Creates a brand new entry in the active lorebook.',
            parameters: {
                type: 'object',
                properties: {
                    content: { type: 'string', description: 'Description of the new entry.' },
                    keys: { type: 'array', items: { type: 'string' }, description: 'Trigger keywords.' },
                    comment: { type: 'string', description: 'Category or note.' }
                },
                required: ['content', 'keys']
            },
            action: async ({ content, keys, comment }) => {
                try {
                    const uid = await handleCreate({ keys, content, comment });
                    return `Successfully created entry UID ${uid} in active lorebook.`;
                } catch (err) {
                    return `Error: ${err.message}`;
                }
            }
        });

        registerFunctionTool({
            name: 'update_lorebook_entry',
            displayName: 'Update Lorebook Entry',
            description: 'Updates an existing entry in the active lorebook using its UID.',
            parameters: {
                type: 'object',
                properties: {
                    uid: { type: 'string', description: 'The UID of the entry.' },
                    content: { type: 'string', description: 'New description.' },
                    keys: { type: 'array', items: { type: 'string' }, description: 'New trigger keywords.' },
                    comment: { type: 'string', description: 'New note.' }
                },
                required: ['uid']
            },
            action: async ({ uid, content, keys, comment }) => {
                try {
                    const result = await handleUpdate({ uid, content, keys, comment });
                    return result.startsWith("Error") ? result : `Successfully updated entry UID ${uid}.`;
                } catch (err) {
                    return `Error: ${err.message}`;
                }
            }
        });
    }

    // === 2. XML TOOL CALL INTERCEPTOR (FOR NON-NATIVE OR FALLBACK MODELS) ===
    console.log("[Lorebook Editor Tool] Initializing XML Tool Call Interceptor...");

    eventSource.on(event_types.MESSAGE_RECEIVED, async (messageId) => {
        try {
            const context = SillyTavern.getContext();
            const chat = context.chat;
            const message = chat[messageId];
            if (!message || message.is_user || !message.mes) return;

            let text = message.mes;
            const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
            let match;
            let modified = false;

            // Make a clone of the regex to loop through matches safely
            const blocks = [...text.matchAll(toolCallRegex)];
            
            for (const block of blocks) {
                const blockContent = block[1];
                
                // Try to parse <create_lorebook_entry>
                const createMatch = /<create_lorebook_entry>([\s\S]*?)<\/create_lorebook_entry>/.exec(blockContent);
                if (createMatch) {
                    const inner = createMatch[1];
                    const name = /<name>([\s\S]*?)<\/name>/.exec(inner)?.[1]?.trim() || /<keys>([\s\S]*?)<\/keys>/.exec(inner)?.[1]?.trim();
                    const content = /<content>([\s\S]*?)<\/content>/.exec(inner)?.[1]?.trim();
                    const comment = /<comment>([\s\S]*?)<\/comment>/.exec(inner)?.[1]?.trim() || "XML Generated";
                    
                    if (name && content) {
                        const keys = name.split(',').map(k => k.trim());
                        const newUid = await handleCreate({ keys, content, comment });
                        toastr.success(`[世界書更新] 成功建立條目 (UID: ${newUid})：${name}`);
                        modified = true;
                    }
                }

                // Try to parse <update_lorebook_entry>
                const updateMatch = /<update_lorebook_entry>([\s\S]*?)<\/update_lorebook_entry>/.exec(blockContent);
                if (updateMatch) {
                    const inner = updateMatch[1];
                    const uid = /<uid>([\s\S]*?)<\/uid>/.exec(inner)?.[1]?.trim();
                    const name = /<name>([\s\S]*?)<\/name>/.exec(inner)?.[1]?.trim() || /<keys>([\s\S]*?)<\/keys>/.exec(inner)?.[1]?.trim();
                    const content = /<content>([\s\S]*?)<\/content>/.exec(inner)?.[1]?.trim();
                    const comment = /<comment>([\s\S]*?)<\/comment>/.exec(inner)?.[1]?.trim();
                    
                    let targetUid = uid;
                    if (!targetUid && name) {
                        targetUid = await findUidByName(name);
                    }

                    if (targetUid && (content || name || comment)) {
                        const keys = name ? name.split(',').map(k => k.trim()) : undefined;
                        await handleUpdate({ uid: targetUid, content, keys, comment });
                        toastr.success(`[世界書更新] 成功更新條目 (UID: ${targetUid})`);
                        modified = true;
                    } else if (!targetUid && name) {
                        // If update failed to find name, fallback to creating it instead!
                        const keys = name.split(',').map(k => k.trim());
                        const newUid = await handleCreate({ keys, content: content || "", comment: comment || "XML Autocreated" });
                        toastr.info(`[世界書更新] 找不到要更新的條目，改為建立新條目 (UID: ${newUid})：${name}`);
                        modified = true;
                    }
                }
            }

            if (modified) {
                // Remove all tool call XML blocks to keep chat clean
                message.mes = text.replace(toolCallRegex, '').trim();
                
                // Save chat to update the server DB
                const { saveChatDebounced } = SillyTavern.getContext();
                if (typeof saveChatDebounced === 'function') {
                    saveChatDebounced();
                }
                
                // Try to trigger DOM update if the message is already rendering
                const messageElement = $(`.mes[message_id="${messageId}"]`);
                if (messageElement.length > 0) {
                    // Update text content in DOM
                    const textContainer = messageElement.find('.mes_text');
                    if (textContainer.length > 0 && typeof window.markdown === 'function') {
                        textContainer.html(window.markdown(message.mes));
                    }
                }
            }
        } catch (err) {
            console.error("[Lorebook Editor Tool] Error in XML interceptor:", err);
        }
    });

} else {
    console.error("[Lorebook Editor Tool] world-info.js core module could not be resolved.");
}
