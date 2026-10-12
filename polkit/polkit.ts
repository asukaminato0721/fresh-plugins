// Select the grammar for known paths. Do not change an existing language choice.
const editor = getEditor();

function detect(buffer) {
    if (buffer.is_virtual || buffer.language !== "text") return;
    const path = buffer.path.replace(/\\/g, "/");
    if (/(?:^|\/)polkit-1\/rules\.d\/[^/]+\.rules$/.test(path)) {
        // This API resolves a filename through the grammar registry.
        editor.setBufferLanguage(buffer.id, "polkit.js");
    }
}

function detectOpenBuffers() {
    for (const buffer of editor.listBuffers()) detect(buffer);
}

registerHandler("polkit_detect_open", function(event) {
    const buffer = editor.listBuffers().find(buffer => buffer.id === event.buffer_id);
    if (buffer) detect(buffer);
});
registerHandler("polkit_detect_ready", detectOpenBuffers);
editor.on("after_file_open", "polkit_detect_open");
editor.on("ready", "polkit_detect_ready");
// Also handle installation or reload after the editor has started.
detectOpenBuffers();
