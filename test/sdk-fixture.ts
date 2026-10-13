import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TestContext } from "node:test";
import type { FauxModelDefinition } from "@earendil-works/pi-ai";
import type { ExtensionFactory, SettingsManager } from "@earendil-works/pi-coding-agent";

/** Keep SDK discovery, credentials and session data inside one disposable root. */
export async function sdkFixture(t: TestContext, options: {
	extensions?: ExtensionFactory[];
	settings?: Parameters<typeof SettingsManager.inMemory>[0];
	models?: FauxModelDefinition[];
	/** Inherited fixtures test explicit/manual behavior. Opt in to exercise production defaults. */
	automaticReview?: boolean;
} = {}) {
	const agentDir = mkdtempSync(join("/var/tmp", "hermes-sdk-"));
	const cwd = join(agentDir, "project");
	const home = join(agentDir, "home");
	const environment = {
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		HOME: process.env.HOME,
		USERPROFILE: process.env.USERPROFILE,
	};
	Object.assign(process.env, { PI_CODING_AGENT_DIR: agentDir, HOME: home, USERPROFILE: home });
	mkdirSync(cwd, { recursive: true });
	mkdirSync(home, { recursive: true });
	if (!options.automaticReview) {
		mkdirSync(join(agentDir, "hermes-memory"), { recursive: true });
		writeFileSync(join(agentDir, "hermes-memory", "config.json"), JSON.stringify({ automaticReview: false }));
	}
	let dispose = () => {};
	t.after(() => {
		dispose();
		for (const [key, value] of Object.entries(environment)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(agentDir, { recursive: true, force: true });
	});
	const { fauxProvider } = await import("@earendil-works/pi-ai");
	const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } =
		await import("@earendil-works/pi-coding-agent");
	const faux = fauxProvider({ provider: "hermes-fixture", models: options.models });
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify({
		"hermes-fixture": { type: "api_key", key: "fixture-only" },
	}));
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"), allowModelNetwork: false,
	});
	modelRuntime.registerNativeProvider(faux.provider);
	const settingsManager = SettingsManager.inMemory({
		retry: { enabled: false, provider: { maxRetries: 0 } },
		compaction: { enabled: false }, cacheWarming: "off", ...options.settings,
	}, { projectTrusted: false });
	const sessionManager = SessionManager.create(cwd, join(agentDir, "sessions"));
	const loader = new DefaultResourceLoader({
		cwd, agentDir, settingsManager,
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		appendSystemPrompt: [],
		extensionFactories: options.extensions,
	});
	await loader.reload();
	const { session, extensionsResult } = await createAgentSession({
		cwd, agentDir, model: faux.getModel(), modelRuntime, settingsManager, sessionManager,
		resourceLoader: loader, noTools: "builtin",
	});
	dispose = () => session.dispose();
	const errors: string[] = extensionsResult.errors.map(error => error.error);
	await session.bindExtensions({ mode: "json", onError: error => errors.push(error.error) });
	return { agentDir, cwd, faux, model: faux.getModel(), modelRuntime, loader, session, sessionManager, settingsManager, errors };
}
