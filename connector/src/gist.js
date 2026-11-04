// Reads and writes the app's sync gist, the same file sync.js uses.
// The token is the signed-in user's own GitHub token (gist scope); it is
// passed in per call and never logged or returned.
import syncLib from "../../sync.js";

const API = "https://api.github.com";
export const FILE = syncLib.FILE; // "to-do-list.json"

function strip(tasks) {
	return (tasks || []).map((t) => {
		const o = {};
		for (const k of Object.keys(t)) if (k !== "_notesOpen") o[k] = t[k];
		return o;
	});
}

export function fileBody(tasks, now = Date.now()) {
	return { [FILE]: { content: JSON.stringify({ version: 1, tasks: strip(tasks), updatedAt: now }, null, 1) } };
}

export function parseFile(text) {
	const data = JSON.parse(text);
	return data && Array.isArray(data.tasks) ? data.tasks : [];
}

export function gistClient(token, fetchImpl = fetch) {
	async function req(method, path, body) {
		const res = await fetchImpl(API + path, {
			method,
			headers: {
				Authorization: "Bearer " + token,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"Content-Type": "application/json",
				"User-Agent": "to-do-list-connector",
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		if (res.status === 401) throw new Error("GitHub rejected the sign-in. Remove and re-add the connector.");
		if (res.status === 403) throw new Error("GitHub refused access to gists.");
		if (res.status === 404) throw new Error("missing");
		if (!res.ok) throw new Error("GitHub error " + res.status);
		return res.status === 204 ? null : res.json();
	}

	async function findId() {
		for (let page = 1; page <= 5; page++) {
			const list = await req("GET", `/gists?per_page=100&page=${page}`);
			const hit = list.find((g) => g.files && g.files[FILE]);
			if (hit) return hit.id;
			if (list.length < 100) break;
		}
		throw new Error("Couldn't find the to-do list's sync gist. Turn on sync in the app first.");
	}

	async function load(id) {
		const g = await req("GET", "/gists/" + id);
		const f = g.files && g.files[FILE];
		if (!f) throw new Error("The sync gist has no " + FILE + ".");
		if (f.truncated) {
			const raw = await fetchImpl(f.raw_url, { headers: { Authorization: "Bearer " + token, "User-Agent": "to-do-list-connector" } });
			return parseFile(await raw.text());
		}
		return parseFile(f.content);
	}

	async function save(id, tasks) {
		await req("PATCH", "/gists/" + id, { files: fileBody(tasks) });
	}

	return {
		findId,
		load,
		save,
		async read() {
			return load(await findId());
		},
		/**
		 * Read the list and hand it to fn. If fn changed anything, merge and write back.
		 * @template T
		 * @param {(tasks: any[]) => T} fn
		 * @returns {Promise<T>}
		 */
		async change(fn) {
			const id = await findId();
			const tasks = await load(id);
			const before = syncLib.normalize(tasks);
			const result = fn(tasks);
			if (syncLib.normalize(tasks) === before) return result;
			// Re-read right before writing, so an edit a device saved meanwhile isn't lost.
			// Our edits carry a newer updatedAt, so they win; everything else keeps the latest copy.
			const latest = await load(id);
			await save(id, syncLib.merge(latest, tasks, Date.now()));
			return result;
		},
	};
}
