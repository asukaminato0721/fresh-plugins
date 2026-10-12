// Select the grammar for known paths. Do not change an existing language choice.
const editor = getEditor();

function detect(buffer) {
    if (buffer.is_virtual || buffer.language !== "text") return;
    const path = buffer.path.replace(/\\/g, "/");
    if (/(?:^|\/)(?:\.ssh\/config|ssh_config)$/.test(path)) {
        // This API resolves a filename through the grammar registry.
        editor.setBufferLanguage(buffer.id, "client.ssh_config");
    }
}

function detectOpenBuffers() {
    for (const buffer of editor.listBuffers()) detect(buffer);
}

registerHandler("ssh_config_detect_open", function(event) {
    const buffer = editor.listBuffers().find(buffer => buffer.id === event.buffer_id);
    if (buffer) detect(buffer);
});
registerHandler("ssh_config_detect_ready", detectOpenBuffers);
editor.on("after_file_open", "ssh_config_detect_open");
editor.on("ready", "ssh_config_detect_ready");
// Also handle installation or reload after the editor has started.
detectOpenBuffers();
