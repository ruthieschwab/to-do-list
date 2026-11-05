import { env } from "cloudflare:workers";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";
import type { Props } from "./utils";
import { gistClient } from "./gist.js";
import { addTask, describe, listTasks, setDone, updateTask } from "./todo.js";

const tagEnum = z.enum(["work", "family", "house", "punch list"]);

function isAllowed(props: Props | undefined): props is Props {
	return !!props && props.login.toLowerCase() === env.ALLOWED_GITHUB_LOGIN.toLowerCase();
}

function text(value: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }] };
}

function failure(err: unknown) {
	return { content: [{ type: "text" as const, text: (err as Error).message || String(err) }], isError: true };
}

function createServer() {
	const server = new McpServer({ name: "To Do List", version: "1.0.0" });
	const props = getMcpAuthContext()?.props as Props | undefined;
	// Sign-in already turns other accounts away (see github-handler.ts); this is a second check.
	if (!isAllowed(props)) return server;
	const gist = () => gistClient(props.accessToken);

	server.registerTool(
		"list_tasks",
		{
			description:
				"List tasks from the to-do list. Open tasks come in list order; done tasks most recently checked off first. Each task has an id to use with the other tools.",
			inputSchema: z.object({
				view: z.enum(["open", "done", "all"]).default("open").describe("Which tasks to include."),
				tags: z.array(tagEnum).optional().describe("Only tasks with any of these tags."),
				untagged: z.boolean().optional().describe("Include tasks with no tags (alone, or alongside tags)."),
				urgent: z.boolean().optional().describe("Only tasks marked urgent."),
				query: z.string().optional().describe("Only tasks whose title or note contains this text."),
				limit: z.number().int().min(1).max(500).optional(),
			}),
		},
		async (args) => {
			try {
				const tasks = await gist().read();
				return text(listTasks(tasks, args).map(describe));
			} catch (e) {
				return failure(e);
			}
		},
	);

	server.registerTool(
		"add_task",
		{
			description:
				"Add a task to the top of the open list. If no tags are given, tags are suggested from the title the same way the app does.",
			inputSchema: z.object({
				title: z.string().min(1),
				note: z.string().optional(),
				tags: z.array(tagEnum).optional(),
				urgent: z.boolean().optional(),
			}),
		},
		async ({ title, note, tags, urgent }) => {
			try {
				const task = await gist().change((tasks) => addTask(tasks, { text: title, notes: note, tags, urgent }));
				return text(describe(task));
			} catch (e) {
				return failure(e);
			}
		},
	);

	server.registerTool(
		"update_task",
		{
			description:
				"Change a task's title, note, tags or urgent flag. Only the fields given change. Setting tags fixes them, so later title edits won't re-suggest tags.",
			inputSchema: z.object({
				id: z.string(),
				title: z.string().min(1).optional(),
				note: z.string().optional().describe("Replaces the whole note. Use an empty string to clear it."),
				tags: z.array(tagEnum).optional().describe("Replaces all tags. Use an empty list for none."),
				urgent: z.boolean().optional(),
			}),
		},
		async ({ id, title, note, tags, urgent }) => {
			try {
				const task = await gist().change((tasks) =>
					updateTask(tasks, id, { text: title, notes: note, tags, urgent }),
				);
				return text(describe(task));
			} catch (e) {
				return failure(e);
			}
		},
	);

	server.registerTool(
		"set_task_done",
		{
			description: "Check a task off (done: true) or reopen it (done: false).",
			inputSchema: z.object({ id: z.string(), done: z.boolean().default(true) }),
		},
		async ({ id, done }) => {
			try {
				const task = await gist().change((tasks) => setDone(tasks, id, done));
				return text(describe(task));
			} catch (e) {
				return failure(e);
			}
		},
	);

	return server;
}

const mcpHandler = createMcpHandler(createServer);
const apiHandler = {
	fetch(request: Request, bindings: Env, ctx: ExecutionContext) {
		return mcpHandler(request, bindings, ctx);
	},
} satisfies ExportedHandler<Env>;

export default new OAuthProvider<Env>({
	apiHandler,
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: GitHubHandler as any,
	tokenEndpoint: "/token",
	// The URL MCP clients connect to. Every token is bound to it.
	resourceMetadata: { resource: env.MCP_RESOURCE },
});
