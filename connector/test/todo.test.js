import { test } from "node:test";
import assert from "node:assert/strict";
import { addTask, describe, listTasks, setDone, updateTask } from "../src/todo.js";
import { fileBody, gistClient, parseFile, FILE } from "../src/gist.js";
import syncLib from "../../sync.js";

// The fields app.js puts on a new task (app.js, the "add" handler).
const APP_FIELDS = ["id", "text", "notes", "done", "order", "doneAt", "tags", "tagsAuto", "urgent", "updatedAt"].sort();

function sample() {
	return [
		{ id: "a", text: "Email recruiter back", notes: "", done: false, order: 0, doneAt: 0, tags: ["work"], tagsAuto: true, urgent: false, updatedAt: 1 },
		{ id: "b", text: "Fix squeaky closet door", notes: "WD-40 in garage", done: false, order: 1, doneAt: 0, tags: ["house", "punch"], tagsAuto: false, urgent: true, updatedAt: 1 },
		{ id: "c", text: "Book flights", notes: "", done: false, order: 2, doneAt: 0, tags: [], tagsAuto: true, urgent: false, updatedAt: 1 },
		{ id: "d", text: "Order cupcakes", notes: "", done: true, order: 3, doneAt: 500, tags: ["fam"], tagsAuto: true, urgent: false, updatedAt: 1 },
		{ id: "e", text: "Old thing", done: true, order: 4, doneAt: 900, tags: [], updatedAt: 1 },
		{ id: "x", deleted: true, updatedAt: 1 },
	];
}

test("new task has exactly the app's fields and goes to the top", () => {
	const tasks = sample();
	const t = addTask(tasks, { text: "  Call the plumber  " }, 1000);
	assert.deepEqual(Object.keys(t).sort(), APP_FIELDS);
	assert.equal(t.text, "Call the plumber");
	assert.equal(t.order, -1);
	assert.equal(t.updatedAt, 1000);
	assert.equal(t.done, false);
	assert.match(t.id, /^t[0-9a-z]+$/);
	assert.equal(listTasks(tasks)[0].id, t.id);
});

test("tags are suggested with the app's rules when none are given", () => {
	const tasks = sample();
	const t = addTask(tasks, { text: "Schedule a meeting with the client" });
	assert.deepEqual(t.tags, ["work"]);
	assert.equal(t.tagsAuto, true);
});

test("given tags are used as-is and count as set by hand", () => {
	const tasks = sample();
	const t = addTask(tasks, { text: "Something", tags: ["punch list", "family"], urgent: true, notes: "n" });
	assert.deepEqual(t.tags, ["fam", "punch"]);
	assert.equal(t.tagsAuto, false);
	assert.equal(t.urgent, true);
	assert.equal(t.notes, "n");
});

test("unknown tags and empty titles are refused", () => {
	assert.throws(() => addTask(sample(), { text: "x", tags: ["garden"] }), /Unknown tag/);
	assert.throws(() => addTask(sample(), { text: "   " }), /title/);
});

test("list: open in order, done newest first, deleted hidden", () => {
	const tasks = sample();
	assert.deepEqual(listTasks(tasks).map((t) => t.id), ["a", "b", "c"]);
	assert.deepEqual(listTasks(tasks, { view: "done" }).map((t) => t.id), ["e", "d"]);
	assert.deepEqual(listTasks(tasks, { view: "all" }).map((t) => t.id), ["a", "b", "c", "e", "d"]);
});

test("list filters: tags (any), untagged, urgent, text", () => {
	const tasks = sample();
	assert.deepEqual(listTasks(tasks, { tags: ["house", "work"] }).map((t) => t.id), ["a", "b"]);
	assert.deepEqual(listTasks(tasks, { untagged: true }).map((t) => t.id), ["c"]);
	assert.deepEqual(listTasks(tasks, { tags: ["work"], untagged: true }).map((t) => t.id), ["a", "c"]);
	assert.deepEqual(listTasks(tasks, { urgent: true }).map((t) => t.id), ["b"]);
	assert.deepEqual(listTasks(tasks, { query: "wd-40" }).map((t) => t.id), ["b"]);
});

test("update: title re-suggests tags only while tags are automatic", () => {
	const tasks = sample();
	updateTask(tasks, "c", { text: "Clean the gutter" }, 2000);
	assert.deepEqual(tasks[2].tags, ["house"]);
	updateTask(tasks, "b", { text: "Meeting with client" }, 2000);
	assert.deepEqual(tasks[1].tags, ["house", "punch"]); // set by hand, kept
	assert.equal(tasks[1].updatedAt, 2000);
});

test("update: tags, note and urgent", () => {
	const tasks = sample();
	updateTask(tasks, "a", { tags: [], notes: "ask about comp", urgent: true }, 3000);
	assert.deepEqual(tasks[0].tags, []);
	assert.equal(tasks[0].tagsAuto, false);
	assert.equal(tasks[0].notes, "ask about comp");
	assert.equal(tasks[0].urgent, true);
});

test("check off and reopen", () => {
	const tasks = sample();
	setDone(tasks, "a", true, 4000);
	assert.equal(tasks[0].done, true);
	assert.equal(tasks[0].doneAt, 4000);
	setDone(tasks, "a", false, 5000);
	assert.equal(tasks[0].done, false);
	assert.equal(tasks[0].doneAt, 0);
	assert.equal(tasks[0].updatedAt, 5000);
});

test("missing or deleted ids are refused", () => {
	assert.throws(() => setDone(sample(), "nope", true), /No task/);
	assert.throws(() => updateTask(sample(), "x", { notes: "" }), /No task/);
});

test("describe uses readable tag names", () => {
	const d = describe(sample()[1]);
	assert.deepEqual(d.tags, ["house", "punch list"]);
	assert.equal(d.urgent, true);
	assert.equal(d.note, "WD-40 in garage");
});

test("file format round-trips and matches sync.js", () => {
	const tasks = sample();
	const body = fileBody(tasks, 42);
	const parsed = JSON.parse(body[FILE].content);
	assert.equal(parsed.version, 1);
	assert.equal(parsed.updatedAt, 42);
	assert.deepEqual(parseFile(body[FILE].content), tasks);
});

// A fake GitHub gist API, enough for gist.js.
function fakeGitHub(initialTasks, { onPatch } = {}) {
	const state = { content: fileBody(initialTasks)[FILE].content, patches: 0 };
	const fetchImpl = async (url, opts = {}) => {
		const u = new URL(url);
		const json = (v) => ({ ok: true, status: 200, json: async () => v });
		if (u.pathname === "/gists" && (opts.method || "GET") === "GET") {
			return json([{ id: "other", files: { "x.txt": {} } }, { id: "g1", files: { [FILE]: {} } }]);
		}
		if (u.pathname === "/gists/g1" && opts.method === "GET") {
			return json({ files: { [FILE]: { content: state.content, truncated: false } } });
		}
		if (u.pathname === "/gists/g1" && opts.method === "PATCH") {
			assert.equal(opts.headers.Authorization, "Bearer tok");
			state.content = JSON.parse(opts.body).files[FILE].content;
			state.patches++;
			if (onPatch) onPatch(state);
			return json({});
		}
		throw new Error("unexpected " + opts.method + " " + url);
	};
	return { state, fetchImpl };
}

test("gist: a change is written back; a no-op is not", async () => {
	const gh = fakeGitHub(sample());
	const client = gistClient("tok", gh.fetchImpl);
	await client.change((tasks) => listTasks(tasks));
	assert.equal(gh.state.patches, 0);
	const t = await client.change((tasks) => addTask(tasks, { text: "New one" }));
	assert.equal(gh.state.patches, 1);
	assert.ok(parseFile(gh.state.content).some((x) => x.id === t.id));
});

test("gist: an edit a device saved meanwhile is kept", async () => {
	const gh = fakeGitHub(sample());
	const client = gistClient("tok", gh.fetchImpl);
	let first = true;
	const t = await client.change((tasks) => {
		// Simulate the phone saving a new task between our read and our write.
		if (first) {
			first = false;
			const phone = parseFile(gh.state.content);
			phone.push({ id: "phone1", text: "From phone", notes: "", done: false, order: -5, doneAt: 0, tags: [], tagsAuto: true, urgent: false, updatedAt: Date.now() });
			gh.state.content = fileBody(phone)[FILE].content;
		}
		return setDone(tasks, "a", true);
	});
	const after = parseFile(gh.state.content);
	assert.ok(after.some((x) => x.id === "phone1"), "phone's task kept");
	assert.equal(after.find((x) => x.id === "a").done, true, "our change kept");
	assert.equal(t.id, "a");
});

test("app merge accepts connector edits as newer", () => {
	const deviceCopy = sample();
	const connectorCopy = sample();
	setDone(connectorCopy, "a", true, Date.now());
	const added = addTask(connectorCopy, { text: "Added by Claude" }, Date.now());
	const merged = syncLib.merge(deviceCopy, connectorCopy, Date.now());
	assert.equal(merged.find((x) => x.id === "a").done, true);
	assert.ok(merged.some((x) => x.id === added.id));
});
