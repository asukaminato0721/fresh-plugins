const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const source = readFileSync(resolve(__dirname, "../plugins/ssh-config.ts"), "utf8");
const positive = ["/home/alice/.ssh/config", "/etc/ssh/ssh_config", "ssh_config", "C:\\Users\\alice\\.ssh\\config"];
const negative = ["/tmp/config", "/tmp/application.conf", "/etc/ssh/sshd_config", "/home/alice/.ssh/known_hosts", "/etc/ssh/sshd_config.d/10-local.conf", "/home/alice/.ssh/config.bak"];

function load(buffers) {
    const calls = [];
    const handlers = {};
    const events = {};
    vm.runInNewContext(source, {
        getEditor: () => ({
            listBuffers: () => buffers,
            setBufferLanguage: (id, grammar) => calls.push([id, grammar]),
            on: (event, handler) => { events[event] = handler; },
        }),
        registerHandler: (name, callback) => { handlers[name] = callback; },
    });
    return { calls, events, emit: (event, args) => handlers[events[event]](args) };
}
const buffer = (path, language = "text") => ({ id: 42, path, language, is_virtual: false });

for (const path of positive) {
    test(`detects ${path} when loaded`, () => {
        assert.deepEqual(load([buffer(path)]).calls, [[42, "client.ssh_config"]]);
    });
}
for (const path of negative) {
    test(`does not claim ${path}`, () => {
        assert.deepEqual(load([buffer(path)]).calls, []);
    });
}
test("handles startup and files opened after plugin load", () => {
    const buffers = [];
    const plugin = load(buffers);
    buffers.push(buffer(positive[0]));
    plugin.emit("ready", {});
    assert.deepEqual(plugin.calls, [[42, "client.ssh_config"]]);
    plugin.calls.length = 0;
    plugin.emit("after_file_open", { buffer_id: 42 });
    assert.deepEqual(plugin.calls, [[42, "client.ssh_config"]]);
    plugin.calls.length = 0;
    plugin.emit("after_file_open", { buffer_id: 999 });
    assert.deepEqual(plugin.calls, []);
});
test("preserves existing language choices and skips virtual buffers", () => {
    assert.deepEqual(load([buffer(positive[0], "python")]).calls, []);
    assert.deepEqual(load([{ ...buffer(positive[0]), is_virtual: true }]).calls, []);
    assert.equal(load([]).events.buffer_activated, undefined);
});
