/**
 * Task 1.1 — official public-API package + deterministic fake-provider validation.
 *
 * Loads ../src/index.ts through the real DefaultResourceLoader + createAgentSession
 * with an isolated /var/tmp agentDir, registered faux provider, and in-memory
 * auth. Asserts: extension loads via official loader, inspect-only command is
 * registered, no model call happens on load, and one deterministic fake request
 * completes without touching personal files.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const EXTENSION_PATH = new URL("../src/index.ts", import.meta.url).pathname;

test("official SDK loads extension; fake provider request runs in isolated agentDir", async (t) => {
	// Task contract: fixtures under fresh /var/tmp task agentDir, not tmpdir().
	const agentDir = mkdtempSync(join("/var/tmp", "hermes-1-1-"));
	const cwd = join(agentDir, "project");
	const previousEnvironment = {
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		HOME: process.env.HOME,
		USERPROFILE: process.env.USERPROFILE,
	};
	const home = join(agentDir, "home");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	mkdirSync(home, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	t.after(() => {
		for (const [key, value] of Object.entries(previousEnvironment)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(agentDir, { recursive: true, force: true });
	});

	// Deterministic fake provider (official pi-ai export).
	const faux = fauxProvider({ provider: "hermes-faux" });
	faux.setResponses([fauxAssistantMessage("fake-ok")]);

	// Isolated auth/settings/models under fresh agentDir — no personal files.
	writeFileSync(
		join(agentDir, "auth.json"),
		JSON.stringify({ "hermes-faux": { type: "api_key", key: "faux-key" } }),
	);
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: join(agentDir, "models.json"),
		allowModelNetwork: false,
	});
	modelRuntime.registerNativeProvider(faux.provider);
	const model = faux.getModel();

	const settingsManager = SettingsManager.inMemory(
		{ retry: { enabled: false }, compaction: { enabled: false }, cacheWarming: "off" },
		{ projectTrusted: false },
	);
	const sessionManager = SessionManager.create(cwd, join(agentDir, "sessions"));

	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt: "Isolated official SDK fixture.",
		appendSystemPrompt: [],
		additionalExtensionPaths: [EXTENSION_PATH],
	});
	await resourceLoader.reload();

	const { session, extensionsResult } = await createAgentSession({
		cwd,
		agentDir,
		model,
		modelRuntime,
		settingsManager,
		sessionManager,
		resourceLoader,
		noTools: "all",
	});
	t.after(() => session.dispose());

	assert.deepEqual(resourceLoader.getAgentsFiles().agentsFiles, []);
	assert.deepEqual(resourceLoader.getSkills().skills, []);
	assert.deepEqual(resourceLoader.getPrompts().prompts, []);
	assert.deepEqual(resourceLoader.getAppendSystemPrompt(), []);
	assert.equal(extensionsResult.extensions.length, 1);

	// Extension loaded through official resource loader, zero errors.
	assert.equal(extensionsResult.errors.length, 0, JSON.stringify(extensionsResult.errors));

	// Loading produced no provider call and no managed-memory writes.
	assert.equal(faux.state.callCount, 0);
	assert.equal(existsSync(join(agentDir, "hermes-memory")), false);

	// Inspect-only command registered.
	const commands = extensionsResult.runtime
		? [...extensionsResult.extensions.flatMap((e) => [...e.commands.keys()])]
		: [];
	assert.ok(commands.includes("hermes-memory"), `commands: ${commands}`);

	// Deterministic fake request runs; usage reported by provider only.
	await session.prompt("ping");
	assert.equal(faux.state.callCount, 1);
	const last = session.messages.at(-1);
	assert.equal(last?.role, "assistant");
	assert.equal(last?.stopReason, "stop");

	// Session file lives inside isolated agentDir. The SDK resolves agentDir via
	// realpathSync, so compare canonical paths (on this box /var/tmp is a symlink).
	const file = session.sessionManager.getSessionFile();
	assert.ok(file);
	const { realpathSync } = await import("node:fs");
	assert.equal(realpathSync(file).startsWith(realpathSync(agentDir)), true, `${file} not under ${agentDir}`);
	assert.ok(readFileSync(file, "utf8").includes("fake-ok"));
});
