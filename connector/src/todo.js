// Task rules for the connector. No network, no Cloudflare APIs, so it can be
// tested with plain Node.
//
// Every change here writes tasks in exactly the shape app.js writes them, and
// stamps `updatedAt`, so the app's merge rule (newest copy of a task wins,
// see ../../sync.js) treats a connector edit like an edit from any device.
import tagsLib from "../../tags.js";

export const TAGS = ["work", "fam", "house", "punch"];
export const TAG_LABELS = { work: "work", fam: "family", house: "house", punch: "punch list" };

// Same id shape as app.js uid().
export function uid(now = Date.now()) {
	return "t" + now.toString(36) + Math.random().toString(36).slice(2, 7);
}

export function liveTasks(tasks) {
	return (tasks || []).filter((t) => t && !t.deleted);
}

function cleanTags(tags) {
	if (!Array.isArray(tags)) return null;
	const out = [];
	for (const k of tags) {
		const key = String(k).toLowerCase().trim();
		const norm = key === "family" ? "fam" : key === "punchlist" || key === "punch list" ? "punch" : key;
		if (!TAGS.includes(norm)) throw new Error(`Unknown tag "${k}". Use: ${TAGS.join(", ")}.`);
		if (!out.includes(norm)) out.push(norm);
	}
	return TAGS.filter((t) => out.includes(t)); // keep the app's tag order
}

function autoTags(tasks, text, exceptId) {
	const examples = liveTasks(tasks).filter((t) => t.id !== exceptId);
	return tagsLib.suggest(text, examples);
}

function find(tasks, id) {
	const t = liveTasks(tasks).find((x) => x.id === id);
	if (!t) throw new Error(`No task with id "${id}".`);
	return t;
}

/**
 * Filter and sort the way the app shows them: open tasks in list order,
 * done tasks most recently checked off first.
 */
export function listTasks(tasks, opts = {}) {
	const view = opts.view || "open";
	const want = cleanTags(opts.tags) || [];
	const q = (opts.query || "").toLowerCase().trim();
	let list = liveTasks(tasks).filter((t) => {
		if (view === "open" && t.done) return false;
		if (view === "done" && !t.done) return false;
		if (opts.urgent && !t.urgent) return false;
		const tags = t.tags || [];
		if (want.length || opts.untagged) {
			const tagHit = tags.some((k) => want.includes(k));
			const untaggedHit = !!opts.untagged && tags.length === 0;
			if (!tagHit && !untaggedHit) return false;
		}
		if (q && !(`${t.text} ${t.notes || ""}`.toLowerCase().includes(q))) return false;
		return true;
	});
	list.sort((a, b) => {
		if (a.done !== b.done) return a.done ? 1 : -1;
		if (a.done) return (b.doneAt || 0) - (a.doneAt || 0);
		return (a.order || 0) - (b.order || 0);
	});
	if (opts.limit) list = list.slice(0, opts.limit);
	return list;
}

/** Adds a task at the top of the open list, like typing it into the app. */
export function addTask(tasks, input, now = Date.now()) {
	const text = String(input.text || "").trim();
	if (!text) throw new Error("A task needs a title.");
	const open = liveTasks(tasks).filter((t) => !t.done);
	const minOrder = open.reduce((m, t) => Math.min(m, t.order || 0), 0);
	const given = cleanTags(input.tags);
	const task = {
		id: uid(now),
		text,
		notes: input.notes ? String(input.notes) : "",
		done: false,
		order: minOrder - 1,
		doneAt: 0,
		tags: given || autoTags(tasks, text),
		tagsAuto: !given,
		urgent: !!input.urgent,
		updatedAt: now,
	};
	tasks.push(task);
	return task;
}

/** Edits title, note, tags or urgent. Tags given here count as set by hand. */
export function updateTask(tasks, id, patch, now = Date.now()) {
	const t = find(tasks, id);
	if (patch.text !== undefined) {
		const text = String(patch.text).trim();
		if (!text) throw new Error("A task needs a title.");
		t.text = text;
		// Same as the app: re-suggest tags on a title change until tags are set by hand.
		if (patch.tags === undefined && t.tagsAuto !== false) t.tags = autoTags(tasks, text, t.id);
	}
	if (patch.notes !== undefined) t.notes = String(patch.notes);
	if (patch.tags !== undefined) {
		t.tags = cleanTags(patch.tags) || [];
		t.tagsAuto = false;
	}
	if (patch.urgent !== undefined) t.urgent = !!patch.urgent;
	t.updatedAt = now;
	return t;
}

/** Checks a task off (done = true) or reopens it (done = false). */
export function setDone(tasks, id, done, now = Date.now()) {
	const t = find(tasks, id);
	t.done = !!done;
	t.doneAt = done ? now : 0;
	t.updatedAt = now;
	return t;
}

/** A compact, readable view of a task for Claude. */
export function describe(t) {
	return {
		id: t.id,
		title: t.text,
		note: t.notes || undefined,
		tags: (t.tags || []).map((k) => TAG_LABELS[k] || k),
		urgent: !!t.urgent || undefined,
		done: !!t.done,
		doneAt: t.done && t.doneAt ? new Date(t.doneAt).toISOString() : undefined,
	};
}
